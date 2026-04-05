import { Bus } from '@jib/bus'
import { type Config, loadConfig } from '@jib/config'
import type { ModuleContext, StartFn } from '@jib/core'
import { registerCloudflareHandlers } from './handlers.ts'

/**
 * Entry point for `jib service start cloudflare`. Connects to NATS, registers
 * the `cmd.cloudflare.domain.*` handlers, and blocks until SIGTERM/SIGINT.
 * Post-initial-setup the operator is mostly idle — its only job is to handle
 * add-domain/remove-domain commands emitted from the CLI.
 */
export const start: StartFn<Config> = async (ctx: ModuleContext<Config>) => {
  const log = ctx.logger
  log.info('starting cloudflare operator')
  const bus = await Bus.connect()

  let disposer = registerCloudflareHandlers(bus, {
    paths: ctx.paths,
    log,
    config: ctx.config,
  })

  bus.subscribe('jib.cmd.config.reload', async () => {
    try {
      const cfg = await loadConfig(ctx.paths.configFile)
      disposer()
      disposer = registerCloudflareHandlers(bus, { paths: ctx.paths, log, config: cfg })
      log.info('config reloaded')
    } catch (err) {
      log.warn(`config reload failed: ${(err as Error).message}`)
    }
  })

  await new Promise<void>((resolve) => {
    const shutdown = async () => {
      log.info('shutting down cloudflare operator')
      disposer()
      await bus.close()
      resolve()
    }
    process.once('SIGTERM', shutdown)
    process.once('SIGINT', shutdown)
  })
}
