import type { Paths } from '@jib/core'
import { $ } from 'bun'
import { consola } from 'consola'

const GROUP = 'jib'

/**
 * Ensure the `jib` system group exists and set `root:jib` ownership on
 * jib-managed directories. Secrets stay root-only (0700); everything
 * else becomes group-readable (0750) so non-root members of the `jib`
 * group can run read-only commands like `jib status`.
 */
export async function ensureGroup(paths: Paths): Promise<void> {
  await $`groupadd --system ${GROUP} 2>/dev/null || true`.quiet()

  // Directories that jib group members may read
  const groupDirs = [
    paths.root,
    paths.stateDir,
    paths.locksDir,
    paths.overridesDir,
    paths.reposDir,
    paths.repoRoot,
    paths.nginxDir,
    paths.busDir,
    paths.cloudflaredDir,
  ]
  for (const d of groupDirs) {
    await $`chown root:${GROUP} ${d}`.quiet().nothrow()
    await $`chmod 750 ${d}`.quiet().nothrow()
  }

  // Config file: group-readable but not world-readable
  await $`chown root:${GROUP} ${paths.configFile}`.quiet().nothrow()
  await $`chmod 640 ${paths.configFile}`.quiet().nothrow()

  // Secrets dir stays root-only
  await $`chmod 700 ${paths.secretsDir}`.quiet().nothrow()

  consola.success('jib group ready')
}

export async function addUserToGroup(user: string): Promise<void> {
  const res = await $`usermod -aG ${GROUP} ${user}`.quiet().nothrow()
  if (res.exitCode === 0) {
    consola.success(`added ${user} to jib group`)
    consola.info('log out and back in for group membership to take effect')
  } else {
    consola.warn(`could not add ${user} to jib group: ${res.stderr.toString().trim()}`)
  }
}
