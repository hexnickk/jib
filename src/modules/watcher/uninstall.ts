import { rm } from 'node:fs/promises'
import { $ } from '@/libs/shell'
import type { Logger } from '@jib/logging'
import type { Paths } from '@jib/paths'
import {
  WatcherUninstallDisableError,
  WatcherUninstallReloadError,
  WatcherUninstallRemoveUnitError,
} from './errors.ts'
import { SERVICE_NAME, UNIT_PATH } from './templates.ts'

interface WatcherContext {
  logger: Logger
  paths: Paths
}

interface WatcherUninstallDeps {
  unitPath?: string
  serviceName?: string
  run?: (args: readonly string[]) => Promise<unknown>
}

/**
 * Stops the watcher unit, deletes it, and reloads systemd.
 * Inputs are the runtime context plus optional path/name overrides for isolated tests.
 * Output is undefined on success or a typed uninstall error; side effects run systemctl and remove the unit file.
 */
export async function watcherUninstallResult(
  ctx: WatcherContext,
  deps: WatcherUninstallDeps = {},
): Promise<
  | WatcherUninstallDisableError
  | WatcherUninstallReloadError
  | WatcherUninstallRemoveUnitError
  | undefined
> {
  const unitPath = deps.unitPath ?? UNIT_PATH
  const serviceName = deps.serviceName ?? SERVICE_NAME
  const run = deps.run ?? ((args: readonly string[]) => $`${args}`)
  let disableError: WatcherUninstallDisableError | undefined

  ctx.logger.info(`systemctl disable --now ${serviceName}`)
  try {
    const result = await run(['sudo', 'systemctl', 'disable', '--now', serviceName])
    const detail = watcherCommandFailure(result)
    if (detail) disableError = new WatcherUninstallDisableError(serviceName, detail)
  } catch (error) {
    disableError = new WatcherUninstallDisableError(serviceName, watcherErrorMessage(error))
  }

  ctx.logger.info(`removing ${unitPath}`)
  try {
    await rm(unitPath, { force: true })
  } catch (error) {
    return new WatcherUninstallRemoveUnitError(unitPath, error)
  }

  ctx.logger.info('systemctl daemon-reload')
  try {
    const result = await run(['sudo', 'systemctl', 'daemon-reload'])
    const detail = watcherCommandFailure(result)
    if (detail) return new WatcherUninstallReloadError(detail)
  } catch (error) {
    return new WatcherUninstallReloadError(watcherErrorMessage(error))
  }

  return disableError
}

function watcherCommandFailure(result: unknown): string | undefined {
  if (!isWatcherCommandResult(result)) return undefined
  if (result.exitCode === 0) return undefined
  return (
    result.stderr.toString().trim() ||
    result.stdout.toString().trim() ||
    `command exited with code ${result.exitCode ?? 1}`
  )
}

function isWatcherCommandResult(result: unknown): result is {
  exitCode: number | null
  stdout: { toString(): string }
  stderr: { toString(): string }
} {
  return (
    typeof result === 'object' &&
    result !== null &&
    'exitCode' in result &&
    'stdout' in result &&
    'stderr' in result
  )
}

function watcherErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
