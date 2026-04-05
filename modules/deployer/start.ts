import { Bus } from '@jib/bus'
import { type Config, loadConfig } from '@jib/config'
import type { ModuleContext, StartFn } from '@jib/core'
import { Store } from '@jib/state'
import { Engine } from './engine.ts'
import { registerDeployerHandlers } from './handlers.ts'

/**
 * Entry point for `jib service start deployer`. Connects to NATS, registers
 * the three command handlers with a factory that re-reads config on every
 * command (so the CLI's `writeConfig` is always observed without a
 * round-trip through `cmd.config.reload`). Blocks until SIGTERM/SIGINT.
 */
export const start: StartFn<Config> = async (ctx: ModuleContext<Config>) => {
  const log = ctx.logger
  log.info('starting deployer')
  const bus = await Bus.connect()
  const store = new Store(ctx.paths.stateDir)

  const engineFactory = async () => {
    const config = await loadConfig(ctx.paths.configFile)
    return new Engine({ config, paths: ctx.paths, store, log })
  }
  const disposer = registerDeployerHandlers(bus, engineFactory)

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
