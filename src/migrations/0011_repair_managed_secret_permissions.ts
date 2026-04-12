import { join } from 'node:path'
import { pathExists } from '@jib/paths'
import type { JibMigration } from './types.ts'

/**
 * Repairs the managed `secrets/_jib` tree for installs that created it without
 * group write permissions. This runs under `sudo jib migrate`, so it can safely
 * restore ownership and modes for future non-root CLI writes.
 */
export async function repairManagedSecretsTree(paths: { secretsDir: string }): Promise<void> {
  const root = join(paths.secretsDir, '_jib')
  if (!(await pathExists(root))) return

  await Bun.$`chown -R root:jib ${root}`.quiet().nothrow()
  await Bun.$`find ${root} -type d -exec chmod 2770 {} +`.quiet().nothrow()
  await Bun.$`find ${root} -type f -exec chmod 640 {} +`.quiet().nothrow()
}

export const m0011_repair_managed_secret_permissions: JibMigration = {
  id: '0011_repair_managed_secret_permissions',
  description: 'Repair jib-managed secret tree permissions',
  up: async (ctx) => {
    await repairManagedSecretsTree(ctx.paths)
  },
}
