import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { type InstallFn, credsPath } from '@jib/core'
import { Bun$ } from './shell.ts'
import { SERVICE_NAME, UNIT_PATH, composeYaml, systemdUnit } from './templates.ts'

/**
 * Writes the compose file + systemd unit under `$JIB_ROOT/cloudflared/` and
 * enables the unit. Does NOT write the tunnel token — that's `jib cloudflare
 * setup`'s job; until the env file exists, the unit will fail to start
 * (by design). Must run as root.
 */
export const install: InstallFn = async (ctx) => {
  const log = ctx.logger
  const dir = ctx.paths.cloudflaredDir
  const tunnelEnvPath = credsPath(ctx.paths, 'cloudflare', 'tunnel.env')
  const vars = { cloudflaredDir: dir, tunnelEnvPath }

  log.info(`creating ${dir}`)
  await mkdir(dir, { recursive: true, mode: 0o755 })

  const composePath = join(dir, 'docker-compose.yml')
  log.info(`writing ${composePath}`)
  await writeFile(composePath, composeYaml(vars), { mode: 0o644 })

  log.info(`writing ${UNIT_PATH}`)
  await writeFile(UNIT_PATH, systemdUnit(vars), { mode: 0o644 })

  log.info('systemctl daemon-reload')
  await Bun$`systemctl daemon-reload`
  log.info(`systemctl enable ${SERVICE_NAME}`)
  await Bun$`systemctl enable ${SERVICE_NAME}`
}
