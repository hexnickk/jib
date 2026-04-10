import { Bus } from '@jib/bus'
import type { Config } from '@jib/config'
import type { ModuleContext, StartFn } from '@jib/core'
import { registerNginxHandlers } from './handlers.ts'

/**
 * Entry point for `jib-daemon start nginx`. Connects to NATS, registers the
 * `cmd.nginx.*` handlers, and blocks until SIGTERM/SIGINT. Unlike the
 * deployer/gitsitter/cloudflare operators, nginx handlers read no config —
 * they only touch filesystem state under `$JIB_ROOT/nginx/` — so there's no
 * `config.reload` subscription to refresh. Add one if that invariant ever
 * changes.
 */
export const start: StartFn<Config> = async (ctx: ModuleContext<Config>) => {
  const log = ctx.logger
  log.info('starting nginx operator')
  const bus = await Bus.connect()

  const disposer = registerNginxHandlers(bus, { paths: ctx.paths, log })

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
