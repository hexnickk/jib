import { SUBJECTS, emitAndWait } from '@jib/rpc'
import { defineCommand } from 'citty'
import { consola } from 'consola'
import { withBus } from '../bus-client.ts'
import { loadAppOrExit } from './_ctx.ts'

const DEFAULT_TIMEOUT_MS = 30_000

/**
 * `jib resume <app>` — clears the deployer's failure/pinned flags so
 * autodeploy can take over again. No progress events for this one: it's
 * effectively a state-file tweak inside the deployer.
 */
export default defineCommand({
  meta: { name: 'resume', description: 'Reset failures, unpin, re-enable autodeploy' },
  args: {
    app: { type: 'positional', required: true },
    timeout: { type: 'string', default: String(DEFAULT_TIMEOUT_MS) },
  },
  async run({ args }) {
    await loadAppOrExit(args.app)
    const timeoutMs = Number(args.timeout) || DEFAULT_TIMEOUT_MS

    try {
      await withBus(async (bus) => {
        await emitAndWait(
          bus,
          SUBJECTS.cmd.resume,
          { app: args.app },
          { success: SUBJECTS.evt.resumeSuccess, failure: SUBJECTS.evt.resumeFailure },
          undefined,
          { source: 'cli', timeoutMs },
        )
      })
      consola.success(`Resumed ${args.app}: pinned=false, failures=0`)
    } catch (err) {
      consola.error(err instanceof Error ? err.message : String(err))
      process.exit(1)
    }
  },
})
