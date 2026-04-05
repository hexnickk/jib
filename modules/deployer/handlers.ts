import type { Bus } from '@jib/bus'
import { SUBJECTS, handleCmd } from '@jib/rpc'
import type { Engine } from './engine.ts'
import { resume } from './resume.ts'
import { rollback } from './rollback.ts'

/**
 * Registers the three command handlers (`cmd.deploy`, `cmd.rollback`,
 * `cmd.resume`) on `bus` and wires each to the matching Engine method. The
 * handler adapter shape is identical across all three — each wraps the engine
 * call, forwards progress events, and returns a success/failure terminal event.
 *
 * `engineFactory` is invoked per command so the engine sees a freshly loaded
 * config. This sidesteps the stale-cache race where the CLI writes config and
 * emits `cmd.deploy` before the operator's `cmd.config.reload` subscription
 * has fired. Engine construction is a pure object allocation — zero overhead.
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

  const rollbackSub = handleCmd(
    bus,
    SUBJECTS.cmd.rollback,
    'deployer',
    'deployer',
    SUBJECTS.evt.rollbackProgress,
    SUBJECTS.evt.rollbackFailure,
    async (cmd) => {
      const engine = await engineFactory()
      try {
        await rollback(engine, { app: cmd.app })
        return { success: { subject: SUBJECTS.evt.rollbackSuccess, body: { app: cmd.app } } }
      } catch (err) {
        return {
          failure: {
            subject: SUBJECTS.evt.rollbackFailure,
            body: { app: cmd.app, error: (err as Error).message },
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

  return () => {
    deploySub.unsubscribe()
    rollbackSub.unsubscribe()
    resumeSub.unsubscribe()
  }
}
