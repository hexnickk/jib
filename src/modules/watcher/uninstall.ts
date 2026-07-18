import { rm } from 'node:fs/promises'
import { $ } from '@/libs/shell'
import { InternalError } from '@jib/errors'
import type { Logger } from '@jib/logging'
import type { Paths } from '@jib/paths'
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

/** Stops the watcher unit, deletes it, and returns an internal error on failure. */
export async function watcherUninstallResult(
  ctx: WatcherContext,
  deps: WatcherUninstallDeps = {},
): Promise<InternalError | undefined> {
  const unitPath = deps.unitPath ?? UNIT_PATH
  const serviceName = deps.serviceName ?? SERVICE_NAME
  const run = deps.run ?? ((args: readonly string[]) => $`${args}`)
  let disableError: InternalError | undefined

  ctx.logger.info(`systemctl disable --now ${serviceName}`)
  try {
    const result = await run(['sudo', 'systemctl', 'disable', '--now', serviceName])
    const detail = watcherCommandFailure(result)
    if (detail) {
      disableError = new InternalError(`systemctl disable --now ${serviceName}: ${detail}`)
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    disableError = new InternalError(`systemctl disable --now ${serviceName}: ${message}`, {
      cause: error,
    })
  }

  ctx.logger.info(`removing ${unitPath}`)
  try {
    await rm(unitPath, { force: true })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return new InternalError(`remove ${unitPath}: ${message}`, { cause: error })
  }

  ctx.logger.info('systemctl daemon-reload')
  try {
    const result = await run(['sudo', 'systemctl', 'daemon-reload'])
    const detail = watcherCommandFailure(result)
    if (detail) {
      return new InternalError(`systemctl daemon-reload: ${detail}`)
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return new InternalError(`systemctl daemon-reload: ${message}`, { cause: error })
  }

  return disableError
}

function watcherCommandFailure(result: unknown): string | undefined {
  if (!isWatcherCommandResult(result)) {
    return undefined
  }
  if (result.exitCode === 0) {
    return undefined
  }
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
