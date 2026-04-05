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

  // Handlers reload config on every command so the CLI's `writeConfig` is
  // always observed. The poller still uses a cached snapshot (updated via
  // `cmd.config.reload`) because per-tick disk reads are wasteful.
  let cachedConfig = ctx.config
  const disposer = registerHandlers(bus, ctx.paths, () => loadConfig(ctx.paths.configFile))

  bus.subscribe('jib.cmd.config.reload', async () => {
    try {
      cachedConfig = await loadConfig(ctx.paths.configFile)
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

  await runPoller({ bus, paths: ctx.paths, getConfig: () => cachedConfig, log }, abort.signal)
}
