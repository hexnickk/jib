import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { InstallFn } from '@jib/core'
import { SERVICE_NAME, UNIT_PATH, composeYaml, natsConf, systemdUnit } from './templates.ts'

/**
 * Writes the compose file, nats.conf, and systemd unit to disk, then
 * daemon-reload + enable --now. Must run as root. Idempotent: re-running
 * overwrites the managed files and re-enables the unit.
 */
export const install: InstallFn = async (ctx) => {
  const log = ctx.logger
  const busDir = ctx.paths.busDir
  const vars = { busDir }

  log.info(`creating ${busDir}`)
  await mkdir(busDir, { recursive: true, mode: 0o755 })

  const composePath = join(busDir, 'docker-compose.yml')
  log.info(`writing ${composePath}`)
  await writeFile(composePath, composeYaml(vars), { mode: 0o644 })

  const confPath = join(busDir, 'nats.conf')
  log.info(`writing ${confPath}`)
  await writeFile(confPath, natsConf(vars), { mode: 0o644 })

  log.info(`writing ${UNIT_PATH}`)
  await writeFile(UNIT_PATH, systemdUnit(vars), { mode: 0o644 })

  log.info('systemctl daemon-reload')
  await Bun.$`systemctl daemon-reload`
  log.info(`systemctl enable --now ${SERVICE_NAME}`)
  await Bun.$`systemctl enable --now ${SERVICE_NAME}`
}
