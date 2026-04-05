import { readdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import type { InstallFn } from '@jib/core'
import { JIB_NGINX_INCLUDE_PATH } from './install.ts'

/**
 * Removes the jib include snippet and every generated site config under
 * `$JIB_ROOT/nginx/`. Leaves nginx itself alone — uninstalling a package
 * the operator may own is out of scope.
 */
export const uninstall: InstallFn = async (ctx) => {
  const log = ctx.logger

  log.info(`removing ${JIB_NGINX_INCLUDE_PATH}`)
  await rm(JIB_NGINX_INCLUDE_PATH, { force: true })

  try {
    const entries = await readdir(ctx.paths.nginxDir)
    for (const e of entries) {
      if (e.endsWith('.conf')) {
        const p = join(ctx.paths.nginxDir, e)
        await rm(p, { force: true })
        log.info(`removed ${p}`)
      }
    }
  } catch {
    // Missing dir is fine.
  }
}
