import { withBus } from '@jib/bus'
import { type CmdSubject, type EvtSubject, SUBJECTS, emitAndWait } from '@jib/rpc'
import { defineCommand } from 'citty'
import { consola } from 'consola'
import { loadAppOrExit } from './_ctx.ts'

/**
 * `jib up|down|restart` — per-app container lifecycle. Emits a command on
 * the bus and waits for the deployer operator to ack. The CLI does no docker
 * work itself; every compose subprocess lives in the deployer process.
 *
 * `exec`/`run` stay in-process (see `shell.ts`) because TTY passthrough over
 * NATS is a nightmare — forwarding stdin/stdout/stderr frames through a
 * message broker is both lossy and laggy. Lifecycle commands don't need TTYs.
 */

const DEFAULT_TIMEOUT_MS = 300_000 // 5 minutes — enough for slow `compose down`

async function emitLifecycle(
  app: string,
  cmdSubject: CmdSubject,
  successEvt: EvtSubject,
  failureEvt: EvtSubject,
  extraPayload: Record<string, unknown> = {},
): Promise<void> {
  await loadAppOrExit(app)
  await withBus(async (bus) => {
    await emitAndWait(
      bus,
      cmdSubject,
      { app, ...extraPayload },
      { success: successEvt, failure: failureEvt },
      undefined,
      { source: 'cli', timeoutMs: DEFAULT_TIMEOUT_MS },
    )
  })
}

export const upCmd = defineCommand({
  meta: { name: 'up', description: 'Start existing containers without rebuilding' },
  args: { app: { type: 'positional', required: true } },
  async run({ args }) {
    try {
      await emitLifecycle(
        args.app,
        SUBJECTS.cmd.appUp,
        SUBJECTS.evt.appUpSuccess,
        SUBJECTS.evt.appUpFailure,
      )
      consola.success(`Started ${args.app}.`)
    } catch (err) {
      consola.error(err instanceof Error ? err.message : String(err))
      process.exit(1)
    }
  },
})

export const downCmd = defineCommand({
  meta: { name: 'down', description: 'Stop containers without removing app from config' },
  args: {
    app: { type: 'positional', required: true },
    volumes: { type: 'boolean', description: 'Also remove Docker volumes' },
  },
  async run({ args }) {
    try {
      await emitLifecycle(
        args.app,
        SUBJECTS.cmd.appDown,
        SUBJECTS.evt.appDownSuccess,
        SUBJECTS.evt.appDownFailure,
        { volumes: Boolean(args.volumes) },
      )
      consola.success(`Stopped ${args.app}.`)
    } catch (err) {
      consola.error(err instanceof Error ? err.message : String(err))
      process.exit(1)
    }
  },
})

export const restartCmd = defineCommand({
  meta: { name: 'restart', description: 'Restart containers without redeploying' },
  args: { app: { type: 'positional', required: true } },
  async run({ args }) {
    try {
      await emitLifecycle(
        args.app,
        SUBJECTS.cmd.appRestart,
        SUBJECTS.evt.appRestartSuccess,
        SUBJECTS.evt.appRestartFailure,
      )
      consola.success(`Restarted ${args.app}.`)
    } catch (err) {
      consola.error(err instanceof Error ? err.message : String(err))
      process.exit(1)
    }
  },
})
