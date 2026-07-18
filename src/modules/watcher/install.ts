import { writeFile } from 'node:fs/promises'
import { $ } from '@/libs/shell'
import { InternalError } from '@jib/errors'
import type { Logger } from '@jib/logging'
import type { Paths } from '@jib/paths'
import { SERVICE_NAME, UNIT_PATH, systemdUnit as watcherSystemdUnit } from './templates.ts'

interface WatcherContext {
  logger: Logger
  paths: Paths
}

interface WatcherInstallDeps {
  unitPath?: string
  serviceName?: string
  systemdUnit?: typeof watcherSystemdUnit
  binPath?: string
  run?: (args: readonly string[]) => Promise<unknown>
}

/** Writes and enables the watcher systemd unit, returning an internal error on failure. */
export async function watcherInstallResult(
  ctx: WatcherContext,
  deps: WatcherInstallDeps = {},
): Promise<InternalError | undefined> {
  const unitPath = deps.unitPath ?? UNIT_PATH
  const serviceName = deps.serviceName ?? SERVICE_NAME
  const renderUnit = deps.systemdUnit ?? watcherSystemdUnit
  const vars = {
    jibRoot: ctx.paths.root,
    binPath: deps.binPath ?? process.argv[1] ?? '/usr/local/bin/jib',
  }
  const run = deps.run ?? ((args: readonly string[]) => $`${args}`)
  ctx.logger.info(`writing ${unitPath}`)
  try {
    await writeFile(unitPath, renderUnit(vars), { mode: 0o644 })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return new InternalError(`write ${unitPath}: ${message}`, { cause: error })
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

  ctx.logger.info(`systemctl enable --now ${serviceName}`)
  try {
    const result = await run(['sudo', 'systemctl', 'enable', '--now', serviceName])
    const detail = watcherCommandFailure(result)
    if (detail) {
      return new InternalError(`systemctl enable --now ${serviceName}: ${detail}`)
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return new InternalError(`systemctl enable --now ${serviceName}: ${message}`, { cause: error })
  }
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
