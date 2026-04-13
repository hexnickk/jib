import { rm } from 'node:fs/promises'
import { join } from 'node:path'
import type { Logger } from '@jib/logging'
import type { Paths } from '@jib/paths'
import {
  CloudflaredUninstallDisableError,
  CloudflaredUninstallError,
  CloudflaredUninstallReloadError,
  CloudflaredUninstallRemoveComposeError,
  CloudflaredUninstallRemoveUnitError,
} from './errors.ts'
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
  exitCode: number
  stderr: { toString(): string }
  stdout: { toString(): string }
}

/** Stops the unit, removes managed files, and returns a typed error on failure. */
export async function cloudflaredUninstallResult(
  ctx: CloudflaredContext,
  deps: CloudflaredUninstallDeps = {},
): Promise<
  | CloudflaredUninstallDisableError
  | CloudflaredUninstallRemoveUnitError
  | CloudflaredUninstallRemoveComposeError
  | CloudflaredUninstallReloadError
  | undefined
> {
  const log = ctx.logger
  const dir = ctx.paths.cloudflaredDir
  const serviceName = deps.serviceName ?? CLOUDFLARED_SERVICE_NAME
  const unitPath = deps.unitPath ?? CLOUDFLARED_UNIT_PATH
  const disableNow =
    deps.disableNow ?? (() => Bun.$`sudo systemctl disable --now ${serviceName}`.nothrow().quiet())
  const daemonReload =
    deps.daemonReload ?? (() => Bun.$`sudo systemctl daemon-reload`.nothrow().quiet())
  let disableError: CloudflaredUninstallDisableError | undefined

  log.info(`systemctl disable --now ${serviceName}`)
  try {
    const result = await disableNow()
    const detail = cloudflaredCommandFailure(result)
    if (detail && !cloudflaredDisableFailureIsIgnorable(detail)) {
      disableError = new CloudflaredUninstallDisableError(serviceName, detail)
    }
  } catch (error) {
    return new CloudflaredUninstallDisableError(serviceName, error)
  }

  log.info(`removing ${unitPath}`)
  try {
    await rm(unitPath, { force: true })
  } catch (error) {
    return new CloudflaredUninstallRemoveUnitError(unitPath, error)
  }

  const composePath = join(dir, 'docker-compose.yml')
  log.info(`removing ${composePath}`)
  try {
    await rm(composePath, { force: true })
  } catch (error) {
    return new CloudflaredUninstallRemoveComposeError(composePath, error)
  }

  log.info('systemctl daemon-reload')
  try {
    const result = await daemonReload()
    const detail = cloudflaredCommandFailure(result)
    if (detail) return new CloudflaredUninstallReloadError(detail)
  } catch (error) {
    return new CloudflaredUninstallReloadError(error)
  }

  return disableError
}

/** Stops the unit, removes managed files, and reloads systemd. */
export async function cloudflaredUninstall(
  ctx: CloudflaredContext,
  deps: CloudflaredUninstallDeps = {},
): Promise<void> {
  const error = await cloudflaredUninstallResult(ctx, deps)
  if (error instanceof CloudflaredUninstallError) throw error
}

function cloudflaredCommandFailure(result: unknown): string | undefined {
  if (!isCloudflaredCommandResult(result)) return undefined
  if (result.exitCode === 0) return undefined
  return (
    result.stderr.toString().trim() ||
    result.stdout.toString().trim() ||
    `command exited with code ${result.exitCode}`
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
