import { type Config, configParseDuration } from '@jib/config'
import { deployApp } from '@jib/deploy'
import type { Logger } from '@jib/logging'
import type { Paths } from '@jib/paths'
import { type ProbeSourceDeps, probe, syncApp } from '@jib/sources'
import { Store } from '@jib/state'
import { WatcherDeployAppError, WatcherProbeAppError, WatcherSyncAppError } from './errors.ts'

type ProbeResult = Awaited<ReturnType<typeof probe>>
type SyncResult = Awaited<ReturnType<typeof syncApp>>

/**
 * Parses jib's `poll_interval` using the same duration grammar the config
 * validator accepts. Falls back to 5 minutes only for invalid raw strings.
 */
export function parsePollInterval(raw: string): number {
  return configParseDuration(raw) ?? 5 * 60_000
}

/**
 * Checks one app: resolves auth, ls-remotes the configured branch, and if
 * the remote SHA differs from the last-seen value, prepares and deploys it
 * directly through the shared deploy flow.
 */
export interface PollAppDeps {
  /** Injected for tests; defaults to the real `sources.lsRemote`. */
  lsRemote?: ProbeSourceDeps['lsRemote']
  /** Injected for tests; defaults to the shared sources sync path. */
  syncApp?: typeof syncApp
  /** Injected for tests; defaults to the shared deploy path. */
  deployPrepared?: typeof deployPreparedApp
}

export type PollAppError = WatcherProbeAppError | WatcherSyncAppError | WatcherDeployAppError

export async function pollApp(
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
): Promise<ProbeResult | WatcherProbeAppError> {
  try {
    return await probe(
      cfg,
      paths,
      { app: appName },
      deps.lsRemote ? { lsRemote: deps.lsRemote } : {},
    )
  } catch (error) {
    return new WatcherProbeAppError(appName, error)
  }
}

async function syncPollApp(
  cfg: Config,
  paths: Paths,
  appName: string,
  deps: PollAppDeps,
): Promise<SyncResult | WatcherSyncAppError> {
  const sync = deps.syncApp ?? syncApp
  try {
    return await sync(cfg, paths, { app: appName })
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
      store: new Store(paths.stateDir),
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
  /** Injected for tests — defaults to an abort-aware `setTimeout`. */
  sleep?: (ms: number, signal: AbortSignal) => Promise<void>
}

/**
 * Long-running polling loop. Exits cleanly when `abort` fires. Held in memory
 * only — the `lastSeen` map is reset on restart, which matches the Go
 * watcher's behavior.
 */
export async function runPollCycle(
  deps: PollerDeps,
  lastSeen: Map<string, string> = new Map(),
): Promise<Map<string, string>> {
  const cfg = await deps.getConfig()
  for (const name of Object.keys(cfg.apps)) {
    const error = await pollApp(cfg, deps.paths, name, lastSeen, deps.log)
    if (error) deps.log.warn(`${name}: poll error: ${error.message}`)
  }
  return lastSeen
}

export async function runPoller(deps: PollerDeps, abort: AbortSignal): Promise<void> {
  const sleep = deps.sleep ?? sleepUntilNextPoll
  const lastSeen = new Map<string, string>()
  while (!abort.aborted) {
    const cfg = await deps.getConfig()
    if (abort.aborted) return
    await runPollCycle(
      {
        ...deps,
        getConfig: () => cfg,
      },
      lastSeen,
    )
    await sleep(parsePollInterval(cfg.poll_interval), abort)
  }
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
