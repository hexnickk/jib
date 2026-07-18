import { rm } from 'node:fs/promises'
import { join } from 'node:path'
import { $ } from '@/libs/shell'
import { InternalError } from '@jib/errors'
import type { Logger } from '@jib/logging'
import type { Paths } from '@jib/paths'
import { CLOUDFLARED_SERVICE_NAME, CLOUDFLARED_UNIT_PATH } from './templates.ts'

interface CloudflaredContext {
  logger: Logger
  paths: Paths
}

interface CloudflaredUninstallDeps {
  serviceName?: string
  unitPath?: string
  disableNow?: () => Promise<unknown>
  daemonReload?: () => Promise<unknown>
}

interface CloudflaredCommandResultLike {
  exitCode: number | null
  stderr: { toString(): string }
  stdout: { toString(): string }
}

/** Stops cloudflared, removes its managed files, and returns an internal error on failure. */
export async function cloudflaredUninstallResult(
  ctx: CloudflaredContext,
  deps: CloudflaredUninstallDeps = {},
): Promise<InternalError | undefined> {
  const log = ctx.logger
  const dir = ctx.paths.cloudflaredDir
  const serviceName = deps.serviceName ?? CLOUDFLARED_SERVICE_NAME
  const unitPath = deps.unitPath ?? CLOUDFLARED_UNIT_PATH
  const disableNow = deps.disableNow ?? (() => $`sudo systemctl disable --now ${serviceName}`)
  const daemonReload = deps.daemonReload ?? (() => $`sudo systemctl daemon-reload`)
  let disableError: InternalError | undefined

  log.info(`systemctl disable --now ${serviceName}`)
  try {
    const result = await disableNow()
    const detail = cloudflaredCommandFailure(result)
    if (detail && !cloudflaredDisableFailureIsIgnorable(detail)) {
      disableError = new InternalError(`systemctl disable --now ${serviceName}: ${detail}`)
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return new InternalError(`systemctl disable --now ${serviceName}: ${message}`, { cause: error })
  }

  log.info(`removing ${unitPath}`)
  try {
    await rm(unitPath, { force: true })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return new InternalError(`remove ${unitPath}: ${message}`, { cause: error })
  }

  const composePath = join(dir, 'docker-compose.yml')
  log.info(`removing ${composePath}`)
  try {
    await rm(composePath, { force: true })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return new InternalError(`remove ${composePath}: ${message}`, { cause: error })
  }

  log.info('systemctl daemon-reload')
  try {
    const result = await daemonReload()
    const detail = cloudflaredCommandFailure(result)
    if (detail) {
      return new InternalError(`systemctl daemon-reload: ${detail}`)
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return new InternalError(`systemctl daemon-reload: ${message}`, { cause: error })
  }

  return disableError
}

/** Extracts a non-zero command's diagnostic text for an internal result error. */
function cloudflaredCommandFailure(result: unknown): string | undefined {
  if (!isCloudflaredCommandResult(result)) {
    return undefined
  }
  const exitCode = result.exitCode ?? 0
  if (exitCode === 0) {
    return undefined
  }
  return (
    result.stderr.toString().trim() ||
    result.stdout.toString().trim() ||
    `command exited with code ${exitCode}`
  )
}

function isCloudflaredCommandResult(result: unknown): result is CloudflaredCommandResultLike {
  return (
    typeof result === 'object' &&
    result !== null &&
    'exitCode' in result &&
    'stderr' in result &&
    'stdout' in result
  )
}

function cloudflaredDisableFailureIsIgnorable(detail: string): boolean {
  const trimmed = detail.trim()
  return (
    /^Unit\s+.+\s+not loaded\.?$/i.test(trimmed) ||
    /^Failed to disable unit:\s+Unit file\s+.+\s+does not exist\.?$/i.test(trimmed)
  )
}
