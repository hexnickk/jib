import { join } from 'node:path'
import { $ } from '@/libs/shell'
import { InternalError } from '@jib/errors'
import { pathsPathExistsResult } from '@jib/paths'
import type { JibMigration } from './types.ts'

/**
 * Repairs the managed `secrets/_jib` tree for installs that created it without
 * group write permissions. This runs under `sudo jib migrate`, so it can safely
 * restore ownership and modes for future non-root CLI writes.
 */
export async function repairManagedSecretsTree(paths: { secretsDir: string }): Promise<
  InternalError | undefined
> {
  const root = join(paths.secretsDir, '_jib')
  const exists = await pathsPathExistsResult(root)
  if (exists instanceof Error) {
    return exists
  }
  if (!exists) {
    return undefined
  }

  return (
    (await runRepairCommand('own managed secret tree', $`chown -R root:jib ${root}`)) ??
    (await runRepairCommand(
      'repair managed secret directories',
      $`find ${root} -type d -exec chmod 2770 {} +`,
    )) ??
    (await runRepairCommand(
      'repair managed secret files',
      $`find ${root} -type f -exec chmod 640 {} +`,
    ))
  )
}

export const m0011_repair_managed_secret_permissions: JibMigration = {
  id: '0011_repair_managed_secret_permissions',
  description: 'Repair jib-managed secret tree permissions',
  async up(ctx) {
    return await repairManagedSecretsTree(ctx.paths)
  },
}

/** Runs a required permission repair command and returns a typed migration error on failure. */
async function runRepairCommand(
  label: string,
  command: Promise<{ exitCode: number | null; stdout: string; stderr: string }>,
): Promise<InternalError | undefined> {
  try {
    const result = await command
    if ((result.exitCode ?? 0) === 0) {
      return undefined
    }
    const detail =
      result.stderr.trim() ||
      result.stdout.trim() ||
      `command exited with code ${result.exitCode ?? 1}`
    return new InternalError(`${label}: ${detail}`)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return new InternalError(`${label}: ${message}`, { cause: error })
  }
}
