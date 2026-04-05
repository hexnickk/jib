import { mkdir, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { type InstallFn, credsPath } from '@jib/core'
import { $ } from 'bun'
import { CLOUDFLARE_SERVICE_NAME, CLOUDFLARE_UNIT_PATH, renderSystemdUnit } from './templates.ts'

/**
 * Ensures the `_jib/cloudflare/` secrets directory exists (for the API
 * token) and installs the systemd unit for the long-running cloudflare
 * operator. Idempotent: rewriting the unit is cheap and `enable --now` is a
 * no-op when the service is already active.
 */
export const install: InstallFn = async (ctx) => {
  const log = ctx.logger
  const secretsDir = dirname(credsPath(ctx.paths, 'cloudflare', 'api-token'))
  log.info(`creating ${secretsDir}`)
  await mkdir(secretsDir, { recursive: true, mode: 0o700 })

  const unit = renderSystemdUnit({ jibRoot: ctx.paths.root, binPath: '/usr/local/bin/jib' })
  log.info(`writing ${CLOUDFLARE_UNIT_PATH}`)
  await writeFile(CLOUDFLARE_UNIT_PATH, unit, { mode: 0o644 })
  log.info('systemctl daemon-reload')
  await $`systemctl daemon-reload`
  log.info(`systemctl enable --now ${CLOUDFLARE_SERVICE_NAME}`)
  await $`systemctl enable --now ${CLOUDFLARE_SERVICE_NAME}`
}
