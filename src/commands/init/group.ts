import { existsSync } from 'node:fs'
import { writeFile } from 'node:fs/promises'
import type { Paths } from '@jib/core'
import { log } from '@jib/tui'
import { $ } from 'bun'

const GROUP = 'jib'
const SUDOERS_PATH = '/etc/sudoers.d/jib'

const SUDOERS_CONTENT = `# jib: allow jib group to manage jib-* systemd services without password
%jib ALL=(root) NOPASSWD: /usr/bin/systemctl start jib-*, \
  /usr/bin/systemctl stop jib-*, \
  /usr/bin/systemctl restart jib-*, \
  /usr/bin/systemctl enable jib-*, \
  /usr/bin/systemctl disable jib-*, \
  /usr/bin/systemctl daemon-reload
`

/**
 * Returns true when the current environment lacks the pieces that only
 * root can create: the jib group, proper ownership, or the sudoers
 * drop-in. When false, `jib init` can run without root.
 */
export function needsRoot(paths: Paths): boolean {
  try {
    const res = Bun.spawnSync(['getent', 'group', GROUP])
    if (res.exitCode !== 0) return true
  } catch {
    return true
  }
  if (!existsSync(SUDOERS_PATH)) return true
  if (!existsSync(paths.root)) return true
  return false
}

/**
 * Create the `jib` system group, set `root:jib` ownership on JIB_ROOT,
 * and install a sudoers drop-in so group members can manage jib-*
 * services without a password.
 */
export async function ensureGroup(paths: Paths): Promise<void> {
  await $`groupadd --system ${GROUP} 2>/dev/null || true`.quiet()

  await $`chown -R root:${GROUP} ${paths.root}`.quiet().nothrow()
  await $`chmod -R g+rwX ${paths.root}`.quiet().nothrow()
  await $`chmod 640 ${paths.configFile}`.quiet().nothrow()

  await installSudoers()
  log.success('jib group ready')
}

async function installSudoers(): Promise<void> {
  const tmp = `${SUDOERS_PATH}.tmp-${process.pid}`
  await writeFile(tmp, SUDOERS_CONTENT, { mode: 0o440 })
  const check = Bun.spawnSync(['visudo', '-cf', tmp])
  if (check.exitCode !== 0) {
    await $`rm -f ${tmp}`.quiet().nothrow()
    log.warning('sudoers validation failed, skipping drop-in')
    return
  }
  await $`mv ${tmp} ${SUDOERS_PATH}`.quiet()
  await $`chown root:root ${SUDOERS_PATH}`.quiet()
}

export async function addUserToGroup(user: string): Promise<void> {
  const res = await $`usermod -aG ${GROUP} ${user}`.quiet().nothrow()
  if (res.exitCode === 0) {
    log.success(`added ${user} to jib group`)
    log.info('log out and back in for group membership to take effect')
  } else {
    log.warning(`could not add ${user} to jib group: ${res.stderr.toString().trim()}`)
  }
}
