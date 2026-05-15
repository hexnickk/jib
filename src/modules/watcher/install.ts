import { writeFile } from 'node:fs/promises'
import type { Logger } from '@jib/logging'
import type { Paths } from '@jib/paths'
import {
  WatcherInstallEnableError,
  WatcherInstallReloadError,
  WatcherInstallWriteUnitError,
} from './errors.ts'
import { SERVICE_NAME, UNIT_PATH, systemdUnit as watcherSystemdUnit } from './templates.ts'

interface WatcherContext {
  logger: Logger
  paths: Paths
}

interface WatcherInstallDeps {
  unitPath?: string
  serviceName?: string
  systemdUnit?: typeof watcherSystemdUnit
}

/**
 * Writes and enables the watcher systemd unit.
 * Inputs are the runtime context plus optional filesystem/template overrides for isolated tests.
 * Output is undefined on success or a typed install error; side effects write the unit file and run systemctl.
 */
export async function watcherInstallResult(
  ctx: WatcherContext,
  deps: WatcherInstallDeps = {},
): Promise<
  WatcherInstallWriteUnitError | WatcherInstallReloadError | WatcherInstallEnableError | undefined
> {
  const unitPath = deps.unitPath ?? UNIT_PATH
  const serviceName = deps.serviceName ?? SERVICE_NAME
  const renderUnit = deps.systemdUnit ?? watcherSystemdUnit
  const vars = { jibRoot: ctx.paths.root, binPath: '/usr/local/bin/jib' }
  ctx.logger.info(`writing ${unitPath}`)
  try {
    await writeFile(unitPath, renderUnit(vars), { mode: 0o644 })
  } catch (error) {
    return new WatcherInstallWriteUnitError(unitPath, error)
  }

  ctx.logger.info('systemctl daemon-reload')
  try {
    await Bun.$`sudo systemctl daemon-reload`.quiet()
  } catch (error) {
    return new WatcherInstallReloadError(error)
  }

  ctx.logger.info(`systemctl enable --now ${serviceName}`)
  try {
    await Bun.$`sudo systemctl enable --now ${serviceName}`.quiet()
  } catch (error) {
    return new WatcherInstallEnableError(serviceName, error)
  }
}
