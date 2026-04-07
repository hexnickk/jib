import { withBus } from '@jib/bus'
import { loadAppOrExit } from '@jib/config'
import { emitAndWait } from './client.ts'
import type { CmdSubject, EvtSubject } from './subjects.ts'

const DEFAULT_TIMEOUT_MS = 300_000 // 5 minutes — enough for slow `compose down`

/**
 * Emit a lifecycle command on the bus and wait for the deployer to ack.
 * Shared by `jib up`, `jib down`, `jib restart`.
 */
export async function emitLifecycle(
  app: string,
  cmdSubject: CmdSubject,
  successEvt: EvtSubject,
  failureEvt: EvtSubject,
): Promise<void> {
  await loadAppOrExit(app)
  await withBus(async (bus) => {
    await emitAndWait(
      bus,
      cmdSubject,
      { app },
      { success: successEvt, failure: failureEvt },
      undefined,
      { source: 'cli', timeoutMs: DEFAULT_TIMEOUT_MS },
    )
  })
}
