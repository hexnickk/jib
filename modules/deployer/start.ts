import { Bus } from '@jib/bus'
import { type Config, loadConfig } from '@jib/config'
import type { ModuleContext, StartFn } from '@jib/core'
import { Store } from '@jib/state'
import { Engine } from './engine.ts'
import { registerDeployerHandlers } from './handlers.ts'

/**
 * Entry point for `jib service start deployer`. Connects to NATS, constructs an
 * `Engine` bound to the current config + state store, registers the three
 * command handlers, and listens for config reloads. Blocks until
 * SIGTERM/SIGINT.
 */
export const start: StartFn<Config> = async (ctx: ModuleContext<Config>) => {
  const log = ctx.logger
  log.info('starting deployer')
  const bus = await Bus.connect()
  const store = new Store(ctx.paths.stateDir)

  let engine = new Engine({ config: ctx.config, paths: ctx.paths, store, log })
  let disposer = registerDeployerHandlers(bus, engine)

  bus.subscribe('jib.cmd.config.reload', async () => {
    try {
      const cfg = await loadConfig(ctx.paths.configFile)
      disposer()
      engine = new Engine({ config: cfg, paths: ctx.paths, store, log })
      disposer = registerDeployerHandlers(bus, engine)
      log.info('config reloaded')
    } catch (err) {
      log.warn(`config reload failed: ${(err as Error).message}`)
    }
  })

  await new Promise<void>((resolve) => {
    const shutdown = async () => {
      log.info('shutting down')
      disposer()
      await bus.close()
      resolve()
    }
    process.once('SIGTERM', shutdown)
    process.once('SIGINT', shutdown)
  })
}
