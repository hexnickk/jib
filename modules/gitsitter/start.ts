import { Bus } from '@jib/bus'
import { type Config, loadConfig } from '@jib/config'
import type { ModuleContext, StartFn } from '@jib/core'
import { registerHandlers } from './handlers.ts'
import { runPoller } from './poller.ts'

/**
 * Entry point for `jib service start gitsitter`. Connects to NATS, registers the
 * `cmd.repo.*` handlers, and kicks off the polling loop. Shuts down cleanly
 * on SIGTERM/SIGINT by aborting the poller and draining the bus.
 */
export const start: StartFn<Config> = async (ctx: ModuleContext<Config>) => {
  const log = ctx.logger
  log.info('starting gitsitter')
  const bus = await Bus.connect()

  let config = ctx.config
  const disposer = registerHandlers(bus, ctx.paths, () => config)

  // Config reload: swap the in-memory copy when anyone publishes `cmd.config.reload`.
  bus.subscribe('jib.cmd.config.reload', async () => {
    try {
      config = await loadConfig(ctx.paths.configFile)
      log.info('config reloaded')
    } catch (err) {
      log.warn(`config reload failed: ${(err as Error).message}`)
    }
  })

  const abort = new AbortController()
  const shutdown = async () => {
    log.info('shutting down')
    abort.abort()
    disposer()
    await bus.close()
  }
  process.once('SIGTERM', shutdown)
  process.once('SIGINT', shutdown)

  await runPoller({ bus, paths: ctx.paths, getConfig: () => config, log }, abort.signal)
}
