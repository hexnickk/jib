import { rm } from 'node:fs/promises'
import type { Logger } from '@jib/logging'
import type { Paths } from '@jib/paths'
import { WatcherUninstallRemoveUnitError } from './errors.ts'
import { SERVICE_NAME, UNIT_PATH } from './templates.ts'

interface WatcherContext {
  logger: Logger
  paths: Paths
}

/** Stops the unit, deletes it, and reloads systemd so the file is fully gone. */
export async function uninstallWatcher(
  ctx: WatcherContext,
): Promise<WatcherUninstallRemoveUnitError | undefined> {
  ctx.logger.info(`systemctl disable --now ${SERVICE_NAME}`)
  await Bun.$`sudo systemctl disable --now ${SERVICE_NAME}`.nothrow().quiet()
  ctx.logger.info(`removing ${UNIT_PATH}`)
  try {
    await rm(UNIT_PATH, { force: true })
  } catch (error) {
    return new WatcherUninstallRemoveUnitError(UNIT_PATH, error)
  }
  await Bun.$`sudo systemctl daemon-reload`.nothrow().quiet()
}

export const uninstall = async (ctx: WatcherContext): Promise<void> => {
  const error = await uninstallWatcher(ctx)
  if (error) throw error
}
