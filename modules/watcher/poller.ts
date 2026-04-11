import { type Config, parseDuration } from '@jib/config'
import { Engine } from '@jib/deploy'
import type { Logger } from '@jib/logging'
import type { Paths } from '@jib/paths'
import { type ProbeSourceDeps, probe, syncApp } from '@jib/sources'
import { Store } from '@jib/state'

/**
 * Parses jib's `poll_interval` using the same duration grammar the config
 * validator accepts. Falls back to 5 minutes only for invalid raw strings.
 */
export function parsePollInterval(raw: string): number {
  return parseDuration(raw) ?? 5 * 60_000
}

/**
 * Checks one app: resolves auth, ls-remotes the configured branch, and if
 * the remote SHA differs from the last-seen value, prepares and deploys it
 * directly through the shared deploy engine.
 */
export interface PollAppDeps {
  /** Injected for tests; defaults to the real `sources.lsRemote`. */
  lsRemote?: ProbeSourceDeps['lsRemote']
  /** Injected for tests; defaults to the shared sources sync path. */
  syncApp?: typeof syncApp
  /** Injected for tests; defaults to the shared deploy path. */
  deployPrepared?: typeof deployPreparedApp
}

export async function pollApp(
  cfg: Config,
  paths: Paths,
  appName: string,
  lastSeen: Map<string, string>,
  log: Logger,
  deps: PollAppDeps = {},
): Promise<void> {
  const app = cfg.apps[appName]
  if (!app || !app.repo || app.repo === 'local') return
  try {
    const source = await probe(
      cfg,
      paths,
      { app: appName },
      deps.lsRemote ? { lsRemote: deps.lsRemote } : {},
    )
    if (!source) return
    const prev = lastSeen.get(appName) ?? ''
    if (source.sha === prev) return

    const sync = deps.syncApp ?? syncApp
    const prepared = await sync(cfg, paths, { app: appName })
    log.info(`${appName}: new sha ${prepared.sha.slice(0, 7)} (was ${prev.slice(0, 7) || 'none'})`)
    await (deps.deployPrepared ?? deployPreparedApp)(cfg, paths, appName, prepared, log)
    lastSeen.set(appName, prepared.sha)
  } catch (err) {
    log.warn(`${appName}: poll error: ${(err as Error).message}`)
  }
}

async function deployPreparedApp(
  cfg: Config,
  paths: Paths,
  appName: string,
  prepared: { workdir: string; sha: string },
  log: Logger,
): Promise<void> {
  const engine = new Engine({
    config: cfg,
    paths,
    store: new Store(paths.stateDir),
    log,
  })
  await engine.deploy(
    { app: appName, workdir: prepared.workdir, sha: prepared.sha, trigger: 'auto' },
    { emit: (step, message) => log.info(`${appName}: ${step}: ${message}`) },
  )
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
    await pollApp(cfg, deps.paths, name, lastSeen, deps.log)
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
