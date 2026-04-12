import { writeFile } from 'node:fs/promises'

export const GROUP = 'jib'
export const SUDOERS_PATH = '/etc/sudoers.d/jib'

export const MINIMAL_CONFIG = `config_version: 3
poll_interval: 5m
modules: {}
apps: {}
`

export function buildSudoersContent(): string {
  return `# jib: allow jib group to manage jib-owned services without password
%jib ALL=(root) NOPASSWD: /usr/bin/systemctl start jib-*, \\
  /usr/bin/systemctl stop jib-*, \\
  /usr/bin/systemctl restart jib-*, \\
  /usr/bin/systemctl enable jib-*, \\
  /usr/bin/systemctl disable jib-*, \\
  /usr/bin/systemctl daemon-reload, \\
  /usr/bin/systemctl reload nginx, \\
  /usr/sbin/nginx -t
`
}

export async function writeValidatedSudoers(path: string, content: string): Promise<void> {
  const tmp = `${path}.tmp-${process.pid}`
  await writeFile(tmp, content, { mode: 0o440 })
  const check = Bun.spawnSync(['visudo', '-cf', tmp])
  if (check.exitCode !== 0) {
    await Bun.$`rm -f ${tmp}`.quiet().nothrow()
    const stderr = check.stderr.toString().trim()
    throw new Error(stderr || `visudo rejected ${path}`)
  }
  await Bun.$`mv ${tmp} ${path}`.quiet()
  await Bun.$`chown root:root ${path}`.quiet()
}
