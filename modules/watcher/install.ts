import { rm, writeFile } from 'node:fs/promises'
import type { InstallFn } from '@jib/core'
import { $ } from 'bun'
import { SERVICE_NAME, UNIT_PATH, systemdUnit } from './templates.ts'

/**
 * Installs the watcher systemd unit. Requires root. The unit runs the main
 * `jib` binary directly, so there is no separate daemon artifact to ship.
 */
export const install: InstallFn = async (ctx) => {
  await $`sudo systemctl disable --now jib-gitsitter.service`.quiet().nothrow()
  await rm('/etc/systemd/system/jib-gitsitter.service', { force: true })

  const vars = { jibRoot: ctx.paths.root, binPath: '/usr/local/bin/jib' }
  ctx.logger.info(`writing ${UNIT_PATH}`)
  await writeFile(UNIT_PATH, systemdUnit(vars), { mode: 0o644 })
  ctx.logger.info('systemctl daemon-reload')
  await $`sudo systemctl daemon-reload`.quiet()
  ctx.logger.info(`systemctl enable --now ${SERVICE_NAME}`)
  await $`sudo systemctl enable --now ${SERVICE_NAME}`.quiet()
}
