import { type Config, configParseDuration } from '@jib/config'
import { InternalError, type JibError } from '@jib/errors'
import type { Logger } from '@jib/logging'
import type { Paths } from '@jib/paths'
import { sourcesProbe } from '@jib/sources'
import { deployRun } from '@/flows/deploy/run.ts'
/** Parses `poll_interval`, defaulting to 5 minutes only for invalid raw strings. */
export function watcherParsePollInterval(raw: string): number {
  return configParseDuration(raw) ?? 5 * 60_000
}
interface PollAppContext {
  cfg: Config
  paths: Paths
  log: Logger
}

/** Checks one app and deploys when the remote SHA changes. */
export async function watcherPollApp(
  ctx: PollAppContext,
  appName: string,
  lastSeen: Map<string, string>,
): Promise<InternalError | undefined> {
  const { cfg, paths, log } = ctx
  const app = cfg.apps[appName]
  if (!app || !app.repo || app.repo === 'local') {
    return
  }
  try {
    const source = await sourcesProbe(cfg, paths, { app: appName })
    if (source instanceof Error) {
      return new InternalError(`probe ${appName}: ${source.message}`, { cause: source })
    }
    const prev = lastSeen.get(appName) ?? ''
    if (!source || source.sha === prev) {
      return
    }
    log.info(`${appName}: new sha ${source.sha.slice(0, 7)} (was ${prev.slice(0, 7) || 'none'})`)
    const result = await deployRun(ctx, { app: appName, trigger: 'auto' })
    if (result instanceof Error) {
      return new InternalError(`deploy ${appName}: ${result.message}`, { cause: result })
    }
    lastSeen.set(appName, result.preparedSha)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return new InternalError(`poll ${appName}: ${message}`, { cause: error })
  }
}

export interface PollerDeps {
  paths: Paths
  getConfig: () => Promise<Config | JibError> | Config | JibError
  log: Logger
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
    const error = await watcherPollApp({ cfg, paths: deps.paths, log: deps.log }, name, lastSeen)
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
    await sleepUntilNextPoll(watcherParsePollInterval(cfg.poll_interval), abort)
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
