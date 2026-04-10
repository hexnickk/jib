import { Bus } from '@jib/bus'
import { type Config, loadConfig } from '@jib/config'
import type { ModuleContext, StartFn } from '@jib/core'
import { runPoller } from './poller.ts'

/**
 * Entry point for `jib-daemon start gitsitter`. Connects to NATS, watches
 * configured repos, and emits deploy commands when a new SHA appears.
 */
export const start: StartFn<Config> = async (ctx: ModuleContext<Config>) => {
  const log = ctx.logger
  log.info('starting gitsitter')
  const bus = await Bus.connect()

  const abort = new AbortController()
  const shutdown = async () => {
    log.info('shutting down')
    abort.abort()
    await bus.close()
  }
  process.once('SIGTERM', shutdown)
  process.once('SIGINT', shutdown)

  await runPoller(
    { bus, paths: ctx.paths, getConfig: () => loadConfig(ctx.paths.configFile), log },
    abort.signal,
  )
}
