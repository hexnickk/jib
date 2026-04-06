import type { Paths } from '@jib/core'
import { $ } from 'bun'
import { consola } from 'consola'

const GROUP = 'jib'

/**
 * Ensure the `jib` system group exists and set `root:jib` ownership on
 * everything under JIB_ROOT. Group members get read + traverse access
 * so non-root users can run jib commands without sudo.
 */
export async function ensureGroup(paths: Paths): Promise<void> {
  await $`groupadd --system ${GROUP} 2>/dev/null || true`.quiet()

  // Set root:jib on everything under JIB_ROOT recursively
  await $`chown -R root:${GROUP} ${paths.root}`.quiet().nothrow()
  await $`chmod -R g+rX ${paths.root}`.quiet().nothrow()

  // Config file: group-readable but not world-readable
  await $`chmod 640 ${paths.configFile}`.quiet().nothrow()

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
