import { rm } from 'node:fs/promises'
import type { Logger } from '@jib/logging'
import type { Paths } from '@jib/paths'
import { WatcherUninstallRemoveUnitError } from './errors.ts'
import { SERVICE_NAME, UNIT_PATH } from './templates.ts'

interface WatcherContext {
  logger: Logger
  paths: Paths
}

interface WatcherUninstallDeps {
  unitPath?: string
  serviceName?: string
}

/**
 * Stops the watcher unit, deletes it, and reloads systemd.
 * Inputs are the runtime context plus optional path/name overrides for isolated tests.
 * Output is undefined on success or a typed remove error; side effects run systemctl and remove the unit file.
 */
export async function watcherUninstallResult(
  ctx: WatcherContext,
  deps: WatcherUninstallDeps = {},
): Promise<WatcherUninstallRemoveUnitError | undefined> {
  const unitPath = deps.unitPath ?? UNIT_PATH
  const serviceName = deps.serviceName ?? SERVICE_NAME
  ctx.logger.info(`systemctl disable --now ${serviceName}`)
  await Bun.$`sudo systemctl disable --now ${serviceName}`.nothrow().quiet()
  ctx.logger.info(`removing ${unitPath}`)
  try {
    await rm(unitPath, { force: true })
  } catch (error) {
    return new WatcherUninstallRemoveUnitError(unitPath, error)
  }
  await Bun.$`sudo systemctl daemon-reload`.nothrow().quiet()
}
