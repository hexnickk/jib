import { join } from 'node:path'
import { $ } from '@/libs/shell'
import { pathsPathExistsResult } from '@jib/paths'
import { RepairPermissionsError } from './errors.ts'
import type { JibMigration } from './types.ts'

/**
 * Repairs the managed `secrets/_jib` tree for installs that created it without
 * group write permissions. This runs under `sudo jib migrate`, so it can safely
 * restore ownership and modes for future non-root CLI writes.
 */
export async function repairManagedSecretsTree(paths: { secretsDir: string }): Promise<
  RepairPermissionsError | undefined
> {
  const root = join(paths.secretsDir, '_jib')
  if ((await pathsPathExistsResult(root)) !== true) return

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
  up: async (ctx) => {
    const error = await repairManagedSecretsTree(ctx.paths)
    if (error) throw error
  },
}

/** Runs a required permission repair command and returns a typed migration error on failure. */
async function runRepairCommand(
  label: string,
  command: Promise<{ exitCode: number | null; stdout: string; stderr: string }>,
): Promise<RepairPermissionsError | undefined> {
  const result = await command
  if ((result.exitCode ?? 0) === 0) return
  const detail =
    result.stderr.trim() ||
    result.stdout.trim() ||
    `command exited with code ${result.exitCode ?? 1}`
  return new RepairPermissionsError(`${label}: ${detail}`)
}
