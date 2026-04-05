import { mkdir } from 'node:fs/promises'
import { dirname } from 'node:path'
import { type InstallFn, credsPath } from '@jib/core'

/**
 * Tiny install: ensures the `_jib/cloudflare/` secrets directory exists
 * with tight perms. The actual tunnel daemon install lives in
 * `modules/cloudflared`; this module only provides hooks + CLI.
 */
export const install: InstallFn = async (ctx) => {
  const secretsDir = dirname(credsPath(ctx.paths, 'cloudflare', 'api-token'))
  ctx.logger.info(`creating ${secretsDir}`)
  await mkdir(secretsDir, { recursive: true, mode: 0o700 })
}
