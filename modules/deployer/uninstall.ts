import { rm } from 'node:fs/promises'
import type { InstallFn } from '@jib/core'
import { $ } from 'bun'
import { SERVICE_NAME, UNIT_PATH } from './templates.ts'

export const uninstall: InstallFn = async (ctx) => {
  ctx.logger.info(`systemctl disable --now ${SERVICE_NAME}`)
  await $`sudo systemctl disable --now ${SERVICE_NAME}`.nothrow().quiet()
  ctx.logger.info(`removing ${UNIT_PATH}`)
  await rm(UNIT_PATH, { force: true })
  await $`sudo systemctl daemon-reload`.nothrow().quiet()
}
