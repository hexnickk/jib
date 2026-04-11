import { rm } from 'node:fs/promises'
import { join } from 'node:path'
import type { Logger } from '@jib/logging'
import type { Paths } from '@jib/paths'
import { SERVICE_NAME, UNIT_PATH } from './templates.ts'

interface CloudflaredContext {
  logger: Logger
  paths: Paths
}

/** Stops the unit, removes the unit file + compose file. Leaves the dir. */
export const uninstall = async (ctx: CloudflaredContext): Promise<void> => {
  const log = ctx.logger
  const dir = ctx.paths.cloudflaredDir

  log.info(`systemctl disable --now ${SERVICE_NAME}`)
  await Bun.$`sudo systemctl disable --now ${SERVICE_NAME}`.nothrow().quiet()

  log.info(`removing ${UNIT_PATH}`)
  await rm(UNIT_PATH, { force: true })

  const composePath = join(dir, 'docker-compose.yml')
  log.info(`removing ${composePath}`)
  await rm(composePath, { force: true })

  log.info('systemctl daemon-reload')
  await Bun.$`sudo systemctl daemon-reload`.nothrow().quiet()
}
