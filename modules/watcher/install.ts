import { writeFile } from 'node:fs/promises'
import type { Logger } from '@jib/logging'
import type { Paths } from '@jib/paths'
import {
  WatcherInstallEnableError,
  WatcherInstallReloadError,
  WatcherInstallWriteUnitError,
} from './errors.ts'
import { SERVICE_NAME, UNIT_PATH, systemdUnit } from './templates.ts'

interface WatcherContext {
  logger: Logger
  paths: Paths
}

/**
 * Writes and enables the watcher systemd unit, returning a typed error on failure.
 */
export async function watcherInstallResult(
  ctx: WatcherContext,
): Promise<
  WatcherInstallWriteUnitError | WatcherInstallReloadError | WatcherInstallEnableError | undefined
> {
  const vars = { jibRoot: ctx.paths.root, binPath: '/usr/local/bin/jib' }
  ctx.logger.info(`writing ${UNIT_PATH}`)
  try {
    await writeFile(UNIT_PATH, systemdUnit(vars), { mode: 0o644 })
  } catch (error) {
    return new WatcherInstallWriteUnitError(UNIT_PATH, error)
  }

  ctx.logger.info('systemctl daemon-reload')
  try {
    await Bun.$`sudo systemctl daemon-reload`.quiet()
  } catch (error) {
    return new WatcherInstallReloadError(error)
  }

  ctx.logger.info(`systemctl enable --now ${SERVICE_NAME}`)
  try {
    await Bun.$`sudo systemctl enable --now ${SERVICE_NAME}`.quiet()
  } catch (error) {
    return new WatcherInstallEnableError(SERVICE_NAME, error)
  }
}

/**
 * Installs the watcher systemd unit. Requires root. The unit runs the main
 * `jib` binary directly, so there is no separate daemon artifact to ship.
 */
export async function watcherInstall(ctx: WatcherContext): Promise<void> {
  const error = await watcherInstallResult(ctx)
  if (error) throw error
}

export { watcherInstall as install, watcherInstallResult as installWatcher }
