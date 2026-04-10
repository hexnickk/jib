import type { Bus } from '@jib/bus'
import type { Config } from '@jib/config'
import type { Paths } from '@jib/core'
import { SUBJECTS, handleCmd } from '@jib/rpc'
import { type SourceTarget, prepareSource, removeSource } from '@jib/sources'

/**
 * Ensures a repo exists on disk at the expected workdir, authenticates via
 * the configured provider, fetches, checks out `ref`, and returns the
 * resolved SHA. All network ops — clone, fetch, ls-remote — go through this
 * helper so we can centralize auth refresh.
 */
export async function prepareRepo(
  cfg: Config,
  paths: Paths,
  target: SourceTarget,
  ref?: string,
): Promise<{ workdir: string; sha: string }> {
  return prepareSource(cfg, paths, target, ref)
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
      if (!cmd.app) throw new Error('repo.prepare missing app')
      const target: SourceTarget = {
        app: cmd.app,
        ...(cmd.repo ? { repo: cmd.repo } : {}),
        ...(cmd.branch ? { branch: cmd.branch } : {}),
        ...(cmd.provider ? { provider: cmd.provider } : {}),
      }
      const { workdir, sha } = await prepareRepo(cfg, paths, target, cmd.ref)
      return {
        success: { subject: SUBJECTS.evt.repoReady, body: { app: target.app, workdir, sha } },
      }
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
      if (!cmd.app) throw new Error('repo.remove missing app')
      const app = cfg.apps[cmd.app]
      const repo = app?.repo ?? cmd.repo
      if (!repo) throw new Error(`app "${cmd.app}" not in config`)
      await removeSource(paths, cmd.app, repo)
      return { success: { subject: SUBJECTS.evt.repoRemoved, body: { app: cmd.app } } }
    },
  )

  return () => {
    prep.unsubscribe()
    rmHandler.unsubscribe()
  }
}
