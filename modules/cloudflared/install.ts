import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { Logger } from '@jib/logging'
import { type Paths, credsPath } from '@jib/paths'
import {
  CloudflaredInstallCreateDirError,
  CloudflaredInstallError,
  CloudflaredInstallReloadError,
  CloudflaredInstallWriteComposeError,
  CloudflaredInstallWriteUnitError,
} from './errors.ts'
import {
  CLOUDFLARED_UNIT_PATH,
  cloudflaredComposeYaml,
  cloudflaredSystemdUnit,
} from './templates.ts'

interface CloudflaredContext {
  logger: Logger
  paths: Paths
}

interface CloudflaredInstallDeps {
  composeYaml?: typeof cloudflaredComposeYaml
  systemdUnit?: typeof cloudflaredSystemdUnit
  unitPath?: string
  daemonReload?: () => Promise<unknown>
}

interface CloudflaredCommandResultLike {
  exitCode: number
  stderr: { toString(): string }
  stdout: { toString(): string }
}

/**
 * Writes the compose file + systemd unit under `$JIB_ROOT/cloudflared/`.
 * Returns a typed error on failure so callers can decide whether to throw.
 */
export async function cloudflaredInstallResult(
  ctx: CloudflaredContext,
  deps: CloudflaredInstallDeps = {},
): Promise<
  | CloudflaredInstallCreateDirError
  | CloudflaredInstallWriteComposeError
  | CloudflaredInstallWriteUnitError
  | CloudflaredInstallReloadError
  | undefined
> {
  const log = ctx.logger
  const dir = ctx.paths.cloudflaredDir
  const tunnelEnvPath = credsPath(ctx.paths, 'cloudflare', 'tunnel.env')
  const vars = { cloudflaredDir: dir, tunnelEnvPath }
  const renderCompose = deps.composeYaml ?? cloudflaredComposeYaml
  const renderUnit = deps.systemdUnit ?? cloudflaredSystemdUnit
  const unitPath = deps.unitPath ?? CLOUDFLARED_UNIT_PATH
  const daemonReload = deps.daemonReload ?? (() => Bun.$`sudo systemctl daemon-reload`.quiet())

  log.info(`creating ${dir}`)
  try {
    await mkdir(dir, { recursive: true, mode: 0o755 })
  } catch (error) {
    return new CloudflaredInstallCreateDirError(dir, error)
  }

  const composePath = join(dir, 'docker-compose.yml')
  log.info(`writing ${composePath}`)
  try {
    await writeFile(composePath, renderCompose(vars), { mode: 0o644 })
  } catch (error) {
    return new CloudflaredInstallWriteComposeError(composePath, error)
  }

  log.info(`writing ${unitPath}`)
  try {
    await writeFile(unitPath, renderUnit(vars), { mode: 0o644 })
  } catch (error) {
    return new CloudflaredInstallWriteUnitError(unitPath, error)
  }

  log.info('systemctl daemon-reload')
  try {
    const result = await daemonReload()
    const detail = cloudflaredCommandFailure(result)
    if (detail) return new CloudflaredInstallReloadError(detail)
  } catch (error) {
    return new CloudflaredInstallReloadError(error)
  }
}

/**
 * Writes the compose file + systemd unit under `$JIB_ROOT/cloudflared/`.
 * Module install hooks still throw because the init hook contract is `Promise<void>`.
 */
export async function cloudflaredInstall(
  ctx: CloudflaredContext,
  deps: CloudflaredInstallDeps = {},
): Promise<void> {
  const error = await cloudflaredInstallResult(ctx, deps)
  if (error instanceof CloudflaredInstallError) throw error
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
