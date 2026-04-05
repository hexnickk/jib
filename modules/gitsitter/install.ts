import { writeFile } from 'node:fs/promises'
import type { InstallFn } from '@jib/core'
import { $ } from 'bun'
import { SERVICE_NAME, UNIT_PATH, systemdUnit } from './templates.ts'

/**
 * Installs the gitsitter systemd unit. Requires root. The unit's ExecStart
 * runs the compiled `jib` binary via `jib run gitsitter`, so the binary has
 * to be on the host at `/usr/local/bin/jib` by the time the unit starts.
 */
export const install: InstallFn = async (ctx) => {
  const vars = { jibRoot: ctx.paths.root, binPath: '/usr/local/bin/jib' }
  ctx.logger.info(`writing ${UNIT_PATH}`)
  await writeFile(UNIT_PATH, systemdUnit(vars), { mode: 0o644 })
  ctx.logger.info('systemctl daemon-reload')
  await $`systemctl daemon-reload`
  ctx.logger.info(`systemctl enable --now ${SERVICE_NAME}`)
  await $`systemctl enable --now ${SERVICE_NAME}`
}
