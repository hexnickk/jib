import type { Bus } from '@jib/bus'
import { SUBJECTS, handleCmd } from '@jib/rpc'
import type { Engine } from './engine.ts'
import { resume } from './resume.ts'

/**
 * Registers every deployer command handler on `bus`:
 *   - `cmd.deploy` / `cmd.resume` — full deploy flow + failure recovery
 *   - `cmd.app.up` / `cmd.app.down` / `cmd.app.restart` — lightweight
 *     lifecycle wrappers over docker compose. Moved from the CLI so every
 *     docker operation lives in a single process; the CLI becomes a pure
 *     event emitter with zero `@jib/docker` imports for these paths.
 *
 * jib intentionally has no rollback: data-changing migrations aren't
 * reversible, so reverting code without data gives false safety. Fix-forward.
 *
 * `engineFactory` is invoked per command so the engine sees a freshly loaded
 * config. This sidesteps the stale-cache race where the CLI writes config and
 * emits `cmd.*` before the operator's `cmd.config.reload` subscription has
 * fired. Engine construction is a pure object allocation — zero overhead.
 */
export function registerDeployerHandlers(
  bus: Bus,
  engineFactory: () => Promise<Engine> | Engine,
): () => void {
  const deploySub = handleCmd(
    bus,
    SUBJECTS.cmd.deploy,
    'deployer',
    'deployer',
    SUBJECTS.evt.deployProgress,
    SUBJECTS.evt.deployFailure,
    async (cmd, ctx) => {
      const progress = {
        emit: (step: string, message: string) =>
          ctx.emitProgress?.({ app: cmd.app, step, message }),
      }
      const engine = await engineFactory()
      try {
        const res = await engine.deploy(
          {
            app: cmd.app,
            workdir: cmd.workdir,
            sha: cmd.sha,
            trigger: cmd.trigger,
            ...(cmd.user !== undefined ? { user: cmd.user } : {}),
          },
          progress,
        )
        return {
          success: {
            subject: SUBJECTS.evt.deploySuccess,
            body: { app: cmd.app, sha: res.deployedSHA, durationMs: res.durationMs },
          },
        }
      } catch (err) {
        return {
          failure: {
            subject: SUBJECTS.evt.deployFailure,
            body: { app: cmd.app, error: (err as Error).message, step: 'deploy' },
          },
        }
      }
    },
  )

  const resumeSub = handleCmd(
    bus,
    SUBJECTS.cmd.resume,
    'deployer',
    'deployer',
    undefined,
    SUBJECTS.evt.resumeFailure,
    async (cmd) => {
      const engine = await engineFactory()
      try {
        await resume(engine, { app: cmd.app })
        return { success: { subject: SUBJECTS.evt.resumeSuccess, body: { app: cmd.app } } }
      } catch (err) {
        return {
          failure: {
            subject: SUBJECTS.evt.resumeFailure,
            body: { app: cmd.app, error: (err as Error).message },
          },
        }
      }
    },
  )

  const upSub = handleCmd(
    bus,
    SUBJECTS.cmd.appUp,
    'deployer',
    'deployer',
    undefined,
    SUBJECTS.evt.appUpFailure,
    async (cmd) => {
      const engine = await engineFactory()
      try {
        await engine.up(cmd.app)
        return { success: { subject: SUBJECTS.evt.appUpSuccess, body: { app: cmd.app } } }
      } catch (err) {
        return {
          failure: {
            subject: SUBJECTS.evt.appUpFailure,
            body: { app: cmd.app, error: (err as Error).message },
          },
        }
      }
    },
  )

  const downSub = handleCmd(
    bus,
    SUBJECTS.cmd.appDown,
    'deployer',
    'deployer',
    undefined,
    SUBJECTS.evt.appDownFailure,
    async (cmd) => {
      const engine = await engineFactory()
      try {
        await engine.down(cmd.app, cmd.volumes)
        return { success: { subject: SUBJECTS.evt.appDownSuccess, body: { app: cmd.app } } }
      } catch (err) {
        return {
          failure: {
            subject: SUBJECTS.evt.appDownFailure,
            body: { app: cmd.app, error: (err as Error).message },
          },
        }
      }
    },
  )

  const restartSub = handleCmd(
    bus,
    SUBJECTS.cmd.appRestart,
    'deployer',
    'deployer',
    undefined,
    SUBJECTS.evt.appRestartFailure,
    async (cmd) => {
      const engine = await engineFactory()
      try {
        await engine.restart(cmd.app)
        return { success: { subject: SUBJECTS.evt.appRestartSuccess, body: { app: cmd.app } } }
      } catch (err) {
        return {
          failure: {
            subject: SUBJECTS.evt.appRestartFailure,
            body: { app: cmd.app, error: (err as Error).message },
          },
        }
      }
    },
  )

  return () => {
    deploySub.unsubscribe()
    resumeSub.unsubscribe()
    upSub.unsubscribe()
    downSub.unsubscribe()
    restartSub.unsubscribe()
  }
}
