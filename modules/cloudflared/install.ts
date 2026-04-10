import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { type InstallFn, credsPath } from '@jib/core'
import { UNIT_PATH, composeYaml, systemdUnit } from './templates.ts'

/**
 * Writes the compose file + systemd unit under `$JIB_ROOT/cloudflared/` but
 * does NOT enable or start the service. cloudflared requires a tunnel token
 * to run; the service is enabled+started only after the user provides a
 * token via `jib init` (tunnel mode) or `jib cloudflared setup`.
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
  await Bun.$`sudo systemctl daemon-reload`.quiet()
  // NOT enabled — cloudflared can't run without a tunnel token. The token
  // is stored by `jib init` or `jib cloudflared setup`, which also
  // enables + starts the service.
}
