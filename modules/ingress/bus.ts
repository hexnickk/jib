import type { Bus } from '@jib/bus'
import { SUBJECTS, emitAndWait } from '@jib/rpc'
import type { IngressOperator } from './types.ts'

export function createBusIngressOperator(bus: Bus, timeoutMs: number): IngressOperator {
  return {
    async claim(claim, onProgress) {
      await emitAndWait(
        bus,
        SUBJECTS.cmd.ingressClaim,
        claim,
        { success: SUBJECTS.evt.ingressReady, failure: SUBJECTS.evt.ingressFailed },
        SUBJECTS.evt.ingressProgress,
        {
          source: 'ingress',
          timeoutMs,
          ...(onProgress ? { onProgress } : {}),
        },
      )
    },
    async release(app, onProgress) {
      await emitAndWait(
        bus,
        SUBJECTS.cmd.ingressRelease,
        { app },
        { success: SUBJECTS.evt.ingressReleased, failure: SUBJECTS.evt.ingressFailed },
        SUBJECTS.evt.ingressProgress,
        {
          source: 'ingress',
          timeoutMs,
          ...(onProgress ? { onProgress } : {}),
        },
      )
    },
  }
}
