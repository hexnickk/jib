import { writeFile } from 'node:fs/promises'
import type { Logger } from '@jib/logging'
import type { Paths } from '@jib/paths'
import { SERVICE_NAME, UNIT_PATH, systemdUnit } from './templates.ts'

interface WatcherContext {
  logger: Logger
  paths: Paths
}

/**
 * Installs the watcher systemd unit. Requires root. The unit runs the main
 * `jib` binary directly, so there is no separate daemon artifact to ship.
 */
export const install = async (ctx: WatcherContext): Promise<void> => {
  const vars = { jibRoot: ctx.paths.root, binPath: '/usr/local/bin/jib' }
  ctx.logger.info(`writing ${UNIT_PATH}`)
  await writeFile(UNIT_PATH, systemdUnit(vars), { mode: 0o644 })
  ctx.logger.info('systemctl daemon-reload')
  await Bun.$`sudo systemctl daemon-reload`.quiet()
  ctx.logger.info(`systemctl enable --now ${SERVICE_NAME}`)
  await Bun.$`sudo systemctl enable --now ${SERVICE_NAME}`.quiet()
}
