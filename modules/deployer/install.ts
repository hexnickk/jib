import { writeFile } from 'node:fs/promises'
import type { InstallFn } from '@jib/core'
import { $ } from 'bun'
import { SERVICE_NAME, UNIT_PATH, systemdUnit } from './templates.ts'

/** Writes the deployer unit file and enables it under systemd. */
export const install: InstallFn = async (ctx) => {
  const vars = { jibRoot: ctx.paths.root, binPath: '/usr/local/bin/jib' }
  ctx.logger.info(`writing ${UNIT_PATH}`)
  await writeFile(UNIT_PATH, systemdUnit(vars), { mode: 0o644 })
  ctx.logger.info('systemctl daemon-reload')
  await $`systemctl daemon-reload`.quiet()
  ctx.logger.info(`systemctl enable --now ${SERVICE_NAME}`)
  await $`systemctl enable --now ${SERVICE_NAME}`.quiet()
}
