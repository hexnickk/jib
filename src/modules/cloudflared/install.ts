import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { $ } from '@/libs/shell'
import { InternalError } from '@jib/errors'
import type { Logger } from '@jib/logging'
import { type Paths, pathsCredsPath } from '@jib/paths'
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

/** Writes cloudflared's managed files and returns an internal error instead of throwing. */
export async function cloudflaredInstallResult(
  ctx: CloudflaredContext,
  deps: CloudflaredInstallDeps = {},
): Promise<InternalError | undefined> {
  const log = ctx.logger
  const dir = ctx.paths.cloudflaredDir
  const tunnelEnvPath = pathsCredsPath(ctx.paths, 'cloudflare', 'tunnel.env')
  const vars = { cloudflaredDir: dir, tunnelEnvPath }
  const renderCompose = deps.composeYaml ?? cloudflaredComposeYaml
  const renderUnit = deps.systemdUnit ?? cloudflaredSystemdUnit
  const unitPath = deps.unitPath ?? CLOUDFLARED_UNIT_PATH
  const daemonReload = deps.daemonReload ?? (() => $`sudo systemctl daemon-reload`)

  log.info(`creating ${dir}`)
  try {
    await mkdir(dir, { recursive: true, mode: 0o755 })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return new InternalError(`create ${dir}: ${message}`, { cause: error })
  }

  const composePath = join(dir, 'docker-compose.yml')
  log.info(`writing ${composePath}`)
  try {
    await writeFile(composePath, renderCompose(vars), { mode: 0o644 })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return new InternalError(`write ${composePath}: ${message}`, { cause: error })
  }

  log.info(`writing ${unitPath}`)
  try {
    await writeFile(unitPath, renderUnit(vars), { mode: 0o644 })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return new InternalError(`write ${unitPath}: ${message}`, { cause: error })
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
}

/** Extracts a non-zero command's diagnostic text for an internal result error. */
function cloudflaredCommandFailure(result: unknown): string | undefined {
  if (!isCloudflaredCommandResult(result)) {
    return undefined
  }
  if (result.exitCode === 0) {
    return undefined
  }
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
