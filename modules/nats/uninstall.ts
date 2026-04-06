import { rm } from 'node:fs/promises'
import { join } from 'node:path'
import type { InstallFn } from '@jib/core'
import { SERVICE_NAME, UNIT_PATH } from './templates.ts'

/**
 * Reverses `install`: stop + disable the unit, remove the unit file and the
 * files under `busDir`. The bus directory itself is left in place — it may
 * contain state we don't own. Missing files are not errors; systemctl
 * failures on already-stopped/already-disabled units are swallowed.
 */
export const uninstall: InstallFn = async (ctx) => {
  const log = ctx.logger
  const busDir = ctx.paths.busDir

  log.info(`systemctl disable --now ${SERVICE_NAME}`)
  await Bun.$`systemctl disable --now ${SERVICE_NAME}`.nothrow().quiet()

  log.info(`removing ${UNIT_PATH}`)
  await rm(UNIT_PATH, { force: true })

  for (const name of ['docker-compose.yml', 'nats.conf']) {
    const p = join(busDir, name)
    log.info(`removing ${p}`)
    await rm(p, { force: true })
  }

  log.info('systemctl daemon-reload')
  await Bun.$`systemctl daemon-reload`.nothrow().quiet()
}
