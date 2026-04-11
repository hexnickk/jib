import { join } from 'node:path'
import type { Paths } from '@jib/paths'
import { pathExists } from '@jib/paths'

/**
 * Repairs the managed `secrets/_jib` tree for installs that created it without
 * group write permissions. This runs under `sudo jib migrate`, so it can safely
 * restore ownership and modes for future non-root CLI writes.
 */
export async function repairManagedSecretsTree(paths: Paths): Promise<void> {
  const root = join(paths.secretsDir, '_jib')
  if (!(await pathExists(root))) return

  await Bun.$`chown -R root:jib ${root}`.quiet().nothrow()
  await Bun.$`find ${root} -type d -exec chmod 2770 {} +`.quiet().nothrow()
  await Bun.$`find ${root} -type f -exec chmod 640 {} +`.quiet().nothrow()
}
