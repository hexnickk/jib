import { rm } from 'node:fs/promises'
import type { Logger } from '@jib/logging'
import type { Paths } from '@jib/paths'
import { $ } from 'bun'
import { SERVICE_NAME, UNIT_PATH } from './templates.ts'

interface WatcherContext {
  logger: Logger
  paths: Paths
}

/** Stops the unit, deletes it, and reloads systemd so the file is fully gone. */
export const uninstall = async (ctx: WatcherContext): Promise<void> => {
  ctx.logger.info(`systemctl disable --now ${SERVICE_NAME}`)
  await $`sudo systemctl disable --now ${SERVICE_NAME}`.nothrow().quiet()
  ctx.logger.info(`removing ${UNIT_PATH}`)
  await rm(UNIT_PATH, { force: true })
  await $`sudo systemctl daemon-reload`.nothrow().quiet()
}
