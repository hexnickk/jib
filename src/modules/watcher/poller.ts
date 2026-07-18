import { type Config, configParseDuration } from '@jib/config'
import { deployApp } from '@jib/deploy'
import { InternalError, type JibError } from '@jib/errors'
import type { Logger } from '@jib/logging'
import type { Paths } from '@jib/paths'
import { type ProbeSourceDeps, sourcesProbe, sourcesSync } from '@jib/sources'
import { stateCreateStore } from '@jib/state'
/** Parses `poll_interval`, defaulting to 5 minutes only for invalid raw strings. */
export function watcherParsePollInterval(raw: string): number {
  return configParseDuration(raw) ?? 5 * 60_000
}
/** Checks one app and deploys when the remote SHA changes. */
export interface PollAppDeps {
  lsRemote?: ProbeSourceDeps['lsRemote']
  syncApp?: typeof sourcesSync
  deployPrepared?: typeof deployPreparedApp
}
export async function watcherPollApp(
  cfg: Config,
  paths: Paths,
  appName: string,
  lastSeen: Map<string, string>,
  log: Logger,
  deps: PollAppDeps = {},
): Promise<InternalError | undefined> {
  const app = cfg.apps[appName]
  if (!app || !app.repo || app.repo === 'local') {
    return
  }
  const source = await probePollApp(cfg, paths, appName, deps)
  if (source instanceof Error) {
    return source
  }
  if (!source) {
    return
  }
  const prev = lastSeen.get(appName) ?? ''
  if (source.sha === prev) {
    return
  }
  const prepared = await syncPollApp(cfg, paths, appName, deps)
  if (prepared instanceof Error) {
    return prepared
  }
  log.info(`${appName}: new sha ${prepared.sha.slice(0, 7)} (was ${prev.slice(0, 7) || 'none'})`)
  const deployError = await deployPreparedAppResult(
    cfg,
    paths,
    appName,
    prepared,
    log,
    deps.deployPrepared ?? deployPreparedApp,
  )
  if (deployError) {
    return deployError
  }
  lastSeen.set(appName, prepared.sha)
}

async function probePollApp(
  cfg: Config,
  paths: Paths,
  appName: string,
  deps: PollAppDeps,
): Promise<InternalError | { branch: string; workdir: string; sha: string } | null> {
  try {
    const result = await sourcesProbe(
      cfg,
      paths,
      { app: appName },
      deps.lsRemote ? { lsRemote: deps.lsRemote } : {},
    )
    return result instanceof Error
      ? new InternalError(`probe ${appName}: ${result.message}`, { cause: result })
      : result
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return new InternalError(`probe ${appName}: ${message}`, { cause: error })
  }
}

async function syncPollApp(
  cfg: Config,
  paths: Paths,
  appName: string,
  deps: PollAppDeps,
): Promise<InternalError | { workdir: string; sha: string }> {
  const sync = deps.syncApp ?? sourcesSync
  try {
    const result = await sync(cfg, paths, { app: appName })
    return result instanceof Error
      ? new InternalError(`sync ${appName}: ${result.message}`, { cause: result })
      : result
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return new InternalError(`sync ${appName}: ${message}`, { cause: error })
  }
}

async function deployPreparedAppResult(
  cfg: Config,
  paths: Paths,
  appName: string,
  prepared: { workdir: string; sha: string },
  log: Logger,
  deployPrepared: typeof deployPreparedApp,
): Promise<InternalError | undefined> {
  try {
    const result = await deployPrepared(cfg, paths, appName, prepared, log)
    return result instanceof Error
      ? new InternalError(`deploy ${appName}: ${result.message}`, { cause: result })
      : undefined
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return new InternalError(`deploy ${appName}: ${message}`, { cause: error })
  }
}

async function deployPreparedApp(
  cfg: Config,
  paths: Paths,
  appName: string,
  prepared: { workdir: string; sha: string },
  log: Logger,
): Promise<InternalError | undefined> {
  const result = await deployApp(
    {
      config: cfg,
      paths,
      store: stateCreateStore(paths.stateDir),
      log,
    },
    { app: appName, workdir: prepared.workdir, sha: prepared.sha, trigger: 'auto' },
    { emit: (step, message) => log.info(`${appName}: ${step}: ${message}`) },
  )
  return result instanceof Error
    ? new InternalError(`deploy ${appName}: ${result.message}`, { cause: result })
    : undefined
}

export interface PollerDeps {
  paths: Paths
  getConfig: () => Promise<Config | JibError> | Config | JibError
  log: Logger
  sleep?: (ms: number, signal: AbortSignal) => Promise<void>
}

/** Runs one polling cycle and returns the updated SHA state or a config-read error. */
export async function watcherRunPollCycle(
  deps: PollerDeps,
  lastSeen: Map<string, string> = new Map(),
): Promise<Map<string, string> | JibError> {
  const cfg = await watcherGetConfig(deps)
  if (cfg instanceof Error) {
    return cfg
  }
  for (const name of Object.keys(cfg.apps)) {
    const error = await watcherPollApp(cfg, deps.paths, name, lastSeen, deps.log)
    if (error) {
      deps.log.warn(`${name}: poll error: ${error.message}`)
    }
  }
  return lastSeen
}

/** Runs polling cycles until aborted, returning a typed config-read error when one occurs. */
export async function watcherRunPoller(
  deps: PollerDeps,
  abort: AbortSignal,
): Promise<JibError | undefined> {
  const sleep = deps.sleep ?? sleepUntilNextPoll
  const lastSeen = new Map<string, string>()
  while (!abort.aborted) {
    const cfg = await watcherGetConfig(deps)
    if (cfg instanceof Error) {
      return cfg
    }
    if (abort.aborted) {
      return
    }
    const cycle = await watcherRunPollCycle(
      {
        ...deps,
        getConfig: () => cfg,
      },
      lastSeen,
    )
    if (cycle instanceof Error) {
      return cycle
    }
    await sleep(watcherParsePollInterval(cfg.poll_interval), abort)
  }
}

/** Reads the current config and converts unexpected loader throws to an internal error. */
async function watcherGetConfig(deps: PollerDeps): Promise<Config | JibError> {
  try {
    return await deps.getConfig()
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return new InternalError(`load watcher config: ${message}`, { cause: error })
  }
}

function sleepUntilNextPoll(ms: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) {
    return Promise.resolve()
  }
  return new Promise((resolve) => {
    const timer = setTimeout(done, ms)
    const onAbort = () => {
      clearTimeout(timer)
      done()
    }
    function done() {
      signal.removeEventListener('abort', onAbort)
      resolve()
    }
    signal.addEventListener('abort', onAbort, { once: true })
  })
}
