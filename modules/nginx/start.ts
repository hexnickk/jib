import { Bus } from '@jib/bus'
import type { Config } from '@jib/config'
import type { ModuleContext, StartFn } from '@jib/core'
import { registerNginxHandlers } from './handlers.ts'

/**
 * Entry point for `jib-daemon start nginx`. Connects to NATS, registers the
 * generic ingress handlers backed by the nginx adapter, and blocks until
 * SIGTERM/SIGINT. Unlike the deployer/gitsitter/cloudflare operators, the
 * nginx wrapper reads no config — it only touches filesystem state under
 * `$JIB_ROOT/nginx/` — so there's no `config.reload` subscription to refresh.
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
