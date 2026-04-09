import { rm } from 'node:fs/promises'
import { applyAuth, refreshAuth } from '@jib-module/github'
import type { Bus } from '@jib/bus'
import type { App, Config } from '@jib/config'
import { type Paths, isExternalRepoURL, pathExists, repoPath } from '@jib/core'
import { SUBJECTS, handleCmd } from '@jib/rpc'
import { cloneURL } from './src/clone-url.ts'
import * as git from './src/git.ts'

interface RepoTarget {
  app: string
  repo?: string | undefined
  branch?: string | undefined
  provider?: string | undefined
}

function resolveApp(cfg: Config, cmd: RepoTarget): App {
  const existing = cfg.apps[cmd.app]
  if (existing) return existing
  if (!cmd.repo) throw new Error(`app "${cmd.app}" not found in config`)
  return {
    repo: cmd.repo,
    branch: cmd.branch ?? 'main',
    domains: [],
    env_file: '.env',
    ...(cmd.provider ? { provider: cmd.provider } : {}),
  }
}

/**
 * Ensures a repo exists on disk at the expected workdir, authenticates via
 * the configured provider, fetches, checks out `ref`, and returns the
 * resolved SHA. All network ops — clone, fetch, ls-remote — go through this
 * helper so we can centralize auth refresh.
 */
export async function prepareRepo(
  cfg: Config,
  paths: Paths,
  target: RepoTarget,
  ref?: string,
): Promise<{ workdir: string; sha: string }> {
  const app = resolveApp(cfg, target)
  const workdir = repoPath(paths, target.app, app.repo)
  const fetchRef = ref ?? app.branch

  const external = isExternalRepoURL(app.repo)
  const auth = !external && app.provider ? await refreshAuth(app.provider, cfg, app, paths) : {}
  const env = auth.sshKeyPath ? git.configureSSHKey(auth.sshKeyPath) : {}
  if (!(await pathExists(workdir))) {
    await git.clone(cloneURL(app, cfg), workdir, { branch: app.branch, env })
  }
  if (!external) await applyAuth(auth, workdir, app.repo)
  await git.fetch(workdir, fetchRef, env)
  const sha = await git.remoteSHA(workdir, fetchRef)
  await git.checkout(workdir, sha)
  return { workdir, sha }
}

/**
 * Registers the `cmd.repo.prepare` and `cmd.repo.remove` handlers on `bus`.
 * Called by `start.ts` after connecting. Returns a disposer that unsubscribes
 * both handlers — used by tests and graceful shutdown.
 */
export function registerHandlers(
  bus: Bus,
  paths: Paths,
  getConfig: () => Promise<Config> | Config,
): () => void {
  // `getConfig` is invoked per command, not cached. Production passes a
  // loader that re-reads `config.yml` on every call so the CLI's
  // `writeConfig` is always observed without a round-trip through
  // `cmd.config.reload`. Tests inject a synchronous stub.
  const prep = handleCmd(
    bus,
    SUBJECTS.cmd.repoPrepare,
    'gitsitter',
    'gitsitter',
    SUBJECTS.evt.repoProgress,
    SUBJECTS.evt.repoFailed,
    async (cmd) => {
      const cfg = await getConfig()
      const { workdir, sha } = await prepareRepo(cfg, paths, cmd, cmd.ref)
      return { success: { subject: SUBJECTS.evt.repoReady, body: { app: cmd.app, workdir, sha } } }
    },
  )

  const rmHandler = handleCmd(
    bus,
    SUBJECTS.cmd.repoRemove,
    'gitsitter',
    'gitsitter',
    undefined,
    SUBJECTS.evt.repoFailed,
    async (cmd) => {
      const cfg = await getConfig()
      const app = cfg.apps[cmd.app]
      const repo = app?.repo ?? cmd.repo
      if (!repo) throw new Error(`app "${cmd.app}" not in config`)
      const workdir = repoPath(paths, cmd.app, repo)
      await rm(workdir, { recursive: true, force: true })
      return { success: { subject: SUBJECTS.evt.repoRemoved, body: { app: cmd.app } } }
    },
  )

  return () => {
    prep.unsubscribe()
    rmHandler.unsubscribe()
  }
}
