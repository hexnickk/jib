import { rm } from 'node:fs/promises'
import { join } from 'node:path'
import type { InstallFn } from '@jib/core'
import { SERVICE_NAME, UNIT_PATH } from './templates.ts'

/** Stops the unit, removes the unit file + compose file. Leaves the dir. */
export const uninstall: InstallFn = async (ctx) => {
  const log = ctx.logger
  const dir = ctx.paths.cloudflaredDir

  log.info(`systemctl disable --now ${SERVICE_NAME}`)
  await Bun.$`systemctl disable --now ${SERVICE_NAME}`.nothrow()

  log.info(`removing ${UNIT_PATH}`)
  await rm(UNIT_PATH, { force: true })

  const composePath = join(dir, 'docker-compose.yml')
  log.info(`removing ${composePath}`)
  await rm(composePath, { force: true })

  log.info('systemctl daemon-reload')
  await Bun.$`systemctl daemon-reload`.nothrow()
}
