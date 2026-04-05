import { Bus } from '@jib/bus'
import type { Config } from '@jib/config'
import type { ModuleContext, StartFn } from '@jib/core'
import { registerNginxHandlers } from './handlers.ts'

/**
 * Entry point for `jib service start nginx`. Connects to NATS, registers the
 * `cmd.nginx.*` handlers, listens for config reloads (not currently needed by
 * handlers — they read no config — but kept for consistency with peer
 * operators), and blocks until SIGTERM/SIGINT.
 */
export const start: StartFn<Config> = async (ctx: ModuleContext<Config>) => {
  const log = ctx.logger
  log.info('starting nginx operator')
  const bus = await Bus.connect()

  let disposer = registerNginxHandlers(bus, { paths: ctx.paths, log })

  bus.subscribe('jib.cmd.config.reload', async () => {
    // Handlers are config-agnostic today, but we still re-register so any
    // future per-config state (e.g. global SSL flags) picks up cleanly.
    disposer()
    disposer = registerNginxHandlers(bus, { paths: ctx.paths, log })
    log.info('config reloaded')
  })

  await new Promise<void>((resolve) => {
    const shutdown = async () => {
      log.info('shutting down nginx operator')
      disposer()
      await bus.close()
      resolve()
    }
    process.once('SIGTERM', shutdown)
    process.once('SIGINT', shutdown)
  })
}
