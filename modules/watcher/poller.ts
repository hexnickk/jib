import { type Config, configParseDuration } from '@jib/config'
import { deployApp } from '@jib/deploy'
import type { Logger } from '@jib/logging'
import type { Paths } from '@jib/paths'
import { type ProbeSourceDeps, sourcesProbe, sourcesSync } from '@jib/sources'
import { stateCreateStore } from '@jib/state'
import { WatcherDeployAppError, WatcherProbeAppError, WatcherSyncAppError } from './errors.ts'

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

export type PollAppError = WatcherProbeAppError | WatcherSyncAppError | WatcherDeployAppError

export async function watcherPollApp(
  cfg: Config,
  paths: Paths,
  appName: string,
  lastSeen: Map<string, string>,
  log: Logger,
  deps: PollAppDeps = {},
): Promise<PollAppError | undefined> {
  const app = cfg.apps[appName]
  if (!app || !app.repo || app.repo === 'local') return

  const source = await probePollApp(cfg, paths, appName, deps)
  if (source instanceof Error) return source
  if (!source) return

  const prev = lastSeen.get(appName) ?? ''
  if (source.sha === prev) return

  const prepared = await syncPollApp(cfg, paths, appName, deps)
  if (prepared instanceof Error) return prepared

  log.info(`${appName}: new sha ${prepared.sha.slice(0, 7)} (was ${prev.slice(0, 7) || 'none'})`)
  let deployError: WatcherDeployAppError | undefined
  try {
    deployError = await (deps.deployPrepared ?? deployPreparedApp)(
      cfg,
      paths,
      appName,
      prepared,
      log,
    )
  } catch (error) {
    return new WatcherDeployAppError(appName, error)
  }
  if (deployError) return deployError

  lastSeen.set(appName, prepared.sha)
}

async function probePollApp(
  cfg: Config,
  paths: Paths,
  appName: string,
  deps: PollAppDeps,
): Promise<WatcherProbeAppError | { branch: string; workdir: string; sha: string } | null> {
  try {
    const result = await sourcesProbe(
      cfg,
      paths,
      { app: appName },
      deps.lsRemote ? { lsRemote: deps.lsRemote } : {},
    )
    return result instanceof Error ? new WatcherProbeAppError(appName, result) : result
  } catch (error) {
    return new WatcherProbeAppError(appName, error)
  }
}

async function syncPollApp(
  cfg: Config,
  paths: Paths,
  appName: string,
  deps: PollAppDeps,
): Promise<WatcherSyncAppError | { workdir: string; sha: string }> {
  const sync = deps.syncApp ?? sourcesSync
  try {
    const result = await sync(cfg, paths, { app: appName })
    return result instanceof Error ? new WatcherSyncAppError(appName, result) : result
  } catch (error) {
    return new WatcherSyncAppError(appName, error)
  }
}

async function deployPreparedApp(
  cfg: Config,
  paths: Paths,
  appName: string,
  prepared: { workdir: string; sha: string },
  log: Logger,
): Promise<WatcherDeployAppError | undefined> {
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
  if (result instanceof Error) return new WatcherDeployAppError(appName, result)
}

export interface PollerDeps {
  paths: Paths
  getConfig: () => Promise<Config> | Config
  log: Logger
  sleep?: (ms: number, signal: AbortSignal) => Promise<void>
}

/** Long-running polling loop. Exits cleanly when `abort` fires. */
export async function watcherRunPollCycle(
  deps: PollerDeps,
  lastSeen: Map<string, string> = new Map(),
): Promise<Map<string, string>> {
  const cfg = await deps.getConfig()
  for (const name of Object.keys(cfg.apps)) {
    const error = await watcherPollApp(cfg, deps.paths, name, lastSeen, deps.log)
    if (error) deps.log.warn(`${name}: poll error: ${error.message}`)
  }
  return lastSeen
}

export async function watcherRunPoller(deps: PollerDeps, abort: AbortSignal): Promise<void> {
  const sleep = deps.sleep ?? sleepUntilNextPoll
  const lastSeen = new Map<string, string>()
  while (!abort.aborted) {
    const cfg = await deps.getConfig()
    if (abort.aborted) return
    await watcherRunPollCycle(
      {
        ...deps,
        getConfig: () => cfg,
      },
      lastSeen,
    )
    await sleep(watcherParsePollInterval(cfg.poll_interval), abort)
  }
}

export {
  watcherParsePollInterval as parsePollInterval,
  watcherPollApp as pollApp,
  watcherRunPollCycle as runPollCycle,
  watcherRunPoller as runPoller,
}

function sleepUntilNextPoll(ms: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.resolve()
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
