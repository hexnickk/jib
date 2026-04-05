import { rm, stat } from 'node:fs/promises'
import { applyAuth, httpsCloneURL, refreshAuth, sshCloneURL } from '@jib-module/github'
import type { Bus } from '@jib/bus'
import type { App, Config } from '@jib/config'
import { type Paths, repoPath } from '@jib/core'
import { SUBJECTS, handleCmd } from '@jib/rpc'
import * as git from './src/git.ts'

/**
 * Resolves the clone URL for an app: GitHub App providers use HTTPS (token
 * baked into the URL later via `applyAuth`), deploy-key providers use SSH.
 * Local ("" or "local") apps aren't polled; the handler rejects them.
 */
function cloneURL(app: App, providerType: 'key' | 'app' | undefined): string {
  return providerType === 'app' ? httpsCloneURL(app.repo) : sshCloneURL(app.repo)
}

async function pathExists(p: string): Promise<boolean> {
  try {
    await stat(p)
    return true
  } catch {
    return false
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
  appName: string,
  ref?: string,
): Promise<{ workdir: string; sha: string }> {
  const app = cfg.apps[appName]
  if (!app) throw new Error(`app "${appName}" not found in config`)
  const workdir = repoPath(paths, appName, app.repo)
  const target = ref ?? app.branch

  const auth = app.provider ? await refreshAuth(app.provider, cfg, app, paths) : {}
  const env = auth.sshKeyPath ? git.configureSSHKey(auth.sshKeyPath) : {}
  const providerType = app.provider ? cfg.github?.providers?.[app.provider]?.type : undefined

  if (!(await pathExists(workdir))) {
    await git.clone(cloneURL(app, providerType), workdir, { branch: app.branch, env })
  }
  await applyAuth(auth, workdir, app.repo)
  await git.fetch(workdir, target, env)
  const sha = await git.remoteSHA(workdir, target)
  await git.checkout(workdir, sha)
  return { workdir, sha }
}

/**
 * Registers the `cmd.repo.prepare` and `cmd.repo.remove` handlers on `bus`.
 * Called by `start.ts` after connecting. Returns a disposer that unsubscribes
 * both handlers — used by tests and graceful shutdown.
 */
export function registerHandlers(bus: Bus, paths: Paths, getConfig: () => Config): () => void {
  const prep = handleCmd(
    bus,
    SUBJECTS.cmd.repoPrepare,
    'gitsitter',
    'gitsitter',
    SUBJECTS.evt.repoProgress,
    SUBJECTS.evt.repoFailed,
    async (cmd) => {
      const { workdir, sha } = await prepareRepo(getConfig(), paths, cmd.app, cmd.ref)
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
      const app = getConfig().apps[cmd.app]
      if (!app) throw new Error(`app "${cmd.app}" not in config`)
      const workdir = repoPath(paths, cmd.app, app.repo)
      await rm(workdir, { recursive: true, force: true })
      return { success: { subject: SUBJECTS.evt.repoRemoved, body: { app: cmd.app } } }
    },
  )

  return () => {
    prep.unsubscribe()
    rmHandler.unsubscribe()
  }
}
