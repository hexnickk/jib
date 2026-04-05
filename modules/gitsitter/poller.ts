import { httpsCloneURL, refreshAuth, sshCloneURL } from '@jib-module/github'
import type { Bus } from '@jib/bus'
import type { App, Config } from '@jib/config'
import { type Logger, type Paths, repoPath } from '@jib/core'
import { SUBJECTS } from '@jib/rpc'
import * as git from './src/git.ts'

/**
 * Parses jib's `poll_interval` ("5m", "30s", ...). Accepts the same subset Go
 * used: integer + unit. Returns milliseconds, defaulting to 5 minutes if the
 * string is unparseable.
 */
export function parsePollInterval(raw: string): number {
  const m = /^(\d+)(s|m|h)$/.exec(raw.trim())
  if (!m) return 5 * 60_000
  const n = Number(m[1])
  const unit = m[2] as 's' | 'm' | 'h'
  const mult = unit === 's' ? 1_000 : unit === 'm' ? 60_000 : 3_600_000
  return n * mult
}

function cloneURL(app: App, cfg: Config): string {
  const providerType = app.provider ? cfg.github?.providers?.[app.provider]?.type : undefined
  return providerType === 'app' ? httpsCloneURL(app.repo) : sshCloneURL(app.repo)
}

/**
 * Checks one app: resolves auth, ls-remotes the configured branch, and if
 * the remote SHA differs from the last-seen value, publishes `cmd.deploy`
 * directly. gitsitter owns the CLI-bypass autodeploy path per Stage 4.
 */
export interface PollAppDeps {
  /** Injected for tests; defaults to the real `git.lsRemote`. */
  lsRemote?: typeof git.lsRemote
}

export async function pollApp(
  bus: Bus,
  cfg: Config,
  paths: Paths,
  appName: string,
  lastSeen: Map<string, string>,
  log: Logger,
  deps: PollAppDeps = {},
): Promise<void> {
  const app = cfg.apps[appName]
  if (!app || !app.repo || app.repo === 'local') return
  const lsRemote = deps.lsRemote ?? git.lsRemote
  try {
    const auth = app.provider ? await refreshAuth(app.provider, cfg, app, paths) : {}
    const env = auth.sshKeyPath ? git.configureSSHKey(auth.sshKeyPath) : {}
    const sha = await lsRemote(cloneURL(app, cfg), app.branch, env)
    if (!sha) return
    const prev = lastSeen.get(appName) ?? ''
    if (sha === prev) return
    lastSeen.set(appName, sha)
    const workdir = repoPath(paths, appName, app.repo)
    log.info(`${appName}: new sha ${sha.slice(0, 7)} (was ${prev.slice(0, 7) || 'none'})`)
    bus.publish(SUBJECTS.cmd.deploy, {
      corrId: crypto.randomUUID(),
      ts: new Date().toISOString(),
      source: 'gitsitter',
      app: appName,
      workdir,
      sha,
      trigger: 'auto' as const,
    })
  } catch (err) {
    log.warn(`${appName}: poll error: ${(err as Error).message}`)
  }
}

export interface PollerDeps {
  bus: Bus
  paths: Paths
  getConfig: () => Config
  log: Logger
  /** Injected for tests — defaults to real `setTimeout`. */
  sleep?: (ms: number) => Promise<void>
}

/**
 * Long-running polling loop. Exits cleanly when `abort` fires. Held in memory
 * only — the `lastSeen` map is reset on restart, which matches the Go
 * watcher's behavior (it read state via the deployer's state store, so the
 * first poll after boot always triggers a deploy if the sha differs).
 */
export async function runPoller(deps: PollerDeps, abort: AbortSignal): Promise<void> {
  const sleep = deps.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)))
  const lastSeen = new Map<string, string>()
  while (!abort.aborted) {
    const cfg = deps.getConfig()
    for (const name of Object.keys(cfg.apps)) {
      if (abort.aborted) return
      await pollApp(deps.bus, cfg, deps.paths, name, lastSeen, deps.log)
    }
    await sleep(parsePollInterval(cfg.poll_interval))
  }
}
