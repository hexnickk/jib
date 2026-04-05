import { withBus } from '@jib/bus'
import { type EvtRollbackProgress, SUBJECTS, emitAndWait } from '@jib/rpc'
import { spinner } from '@jib/tui'
import { defineCommand } from 'citty'
import { consola } from 'consola'
import { loadAppOrExit } from './_ctx.ts'

const DEFAULT_TIMEOUT_MS = 5 * 60_000

/**
 * `jib rollback <app>` — simpler than deploy: no repo prep, just publish the
 * rollback command and wait for the terminal event. Progress events update a
 * single spinner.
 */
export default defineCommand({
  meta: { name: 'rollback', description: 'Swap to previous version' },
  args: {
    app: { type: 'positional', required: true },
    timeout: { type: 'string', default: String(DEFAULT_TIMEOUT_MS) },
  },
  async run({ args }) {
    await loadAppOrExit(args.app)
    const timeoutMs = Number(args.timeout) || DEFAULT_TIMEOUT_MS

    try {
      await withBus(async (bus) => {
        const s = spinner()
        s.start(`rolling back ${args.app}`)
        await emitAndWait(
          bus,
          SUBJECTS.cmd.rollback,
          { app: args.app },
          { success: SUBJECTS.evt.rollbackSuccess, failure: SUBJECTS.evt.rollbackFailure },
          SUBJECTS.evt.rollbackProgress,
          {
            source: 'cli',
            timeoutMs,
            onProgress: (p: EvtRollbackProgress) => s.message(`${p.step}: ${p.message}`),
          },
        )
        s.stop(`OK  ${args.app} rolled back`)
      })
    } catch (err) {
      consola.error(err instanceof Error ? err.message : String(err))
      process.exit(1)
    }
  },
})
