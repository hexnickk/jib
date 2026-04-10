import type { Bus } from '@jib/bus'
import { SUBJECTS, handleCmd } from '@jib/rpc'
import type { IngressOperator } from './types.ts'

export interface IngressLogger {
  info(message: string): void
  warn(message: string): void
}

export function registerIngressHandlers(
  bus: Bus,
  operator: IngressOperator,
  log: IngressLogger,
): () => void {
  const claimSub = handleCmd(
    bus,
    SUBJECTS.cmd.ingressClaim,
    'ingress',
    'ingress',
    SUBJECTS.evt.ingressProgress,
    SUBJECTS.evt.ingressFailed,
    async (cmd, ctx) => {
      try {
        await operator.claim(cmd, ctx.emitProgress)
        log.info(`ingress claim ready for ${cmd.app}`)
        return { success: { subject: SUBJECTS.evt.ingressReady, body: { app: cmd.app } } }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        log.warn(`ingress claim failed for ${cmd.app}: ${message}`)
        return {
          failure: {
            subject: SUBJECTS.evt.ingressFailed,
            body: { app: cmd.app, error: message },
          },
        }
      }
    },
  )

  const releaseSub = handleCmd(
    bus,
    SUBJECTS.cmd.ingressRelease,
    'ingress',
    'ingress',
    SUBJECTS.evt.ingressProgress,
    SUBJECTS.evt.ingressFailed,
    async (cmd, ctx) => {
      try {
        await operator.release(cmd.app, ctx.emitProgress)
        log.info(`ingress released ${cmd.app}`)
        return { success: { subject: SUBJECTS.evt.ingressReleased, body: { app: cmd.app } } }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        log.warn(`ingress release failed for ${cmd.app}: ${message}`)
        return {
          failure: {
            subject: SUBJECTS.evt.ingressFailed,
            body: { app: cmd.app, error: message },
          },
        }
      }
    },
  )

  return () => {
    claimSub.unsubscribe()
    releaseSub.unsubscribe()
  }
}
