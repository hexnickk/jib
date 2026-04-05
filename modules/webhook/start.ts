import { readFile } from 'node:fs/promises'
import { Bus } from '@jib/bus'
import { type Config, loadConfig } from '@jib/config'
import { JibError, type ModuleContext, type StartFn } from '@jib/core'
import { serve } from './server.ts'

/**
 * Entry point for `jib service start webhook`. Reads the secret from disk
 * (configured by `jib webhook setup`), connects to NATS, and serves the
 * GitHub receiver endpoint until SIGTERM/SIGINT. Config reloads refresh the
 * in-memory app map so repo/branch changes apply without a restart.
 */
export const start: StartFn<Config> = async (ctx: ModuleContext<Config>) => {
  const log = ctx.logger
  const wh = ctx.config.webhook
  if (!wh?.enabled) {
    throw new JibError('webhook.start', 'webhook not configured — run `jib webhook setup`')
  }
  const secret = (await readFile(wh.secret_path, 'utf8')).trim()
  if (!secret) throw new JibError('webhook.start', `empty secret at ${wh.secret_path}`)

  const bus = await Bus.connect()
  let current: Config = ctx.config
  const server = serve({
    bus,
    getConfig: () => current,
    secret,
    log,
    listen: wh.listen,
  })

  bus.subscribe('jib.cmd.config.reload', async () => {
    try {
      current = await loadConfig(ctx.paths.configFile)
      log.info('config reloaded')
    } catch (err) {
      log.warn(`config reload failed: ${(err as Error).message}`)
    }
  })

  await new Promise<void>((resolve) => {
    const shutdown = async () => {
      log.info('shutting down')
      await server.stop()
      await bus.close()
      resolve()
    }
    process.once('SIGTERM', shutdown)
    process.once('SIGINT', shutdown)
  })
}
