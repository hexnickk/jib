import { readdir, rm } from 'node:fs/promises'
import type { IngressHook } from '../types.ts'
import { JIB_NGINX_INCLUDE_PATH } from './install.ts'

/**
 * Removes the jib include snippet and every generated site config under
 * `$JIB_ROOT/nginx/`. Leaves nginx itself alone — uninstalling a package
 * the operator may own is out of scope.
 */
export const uninstall: IngressHook = async (ctx) => {
  const log = ctx.logger

  log.info(`removing ${JIB_NGINX_INCLUDE_PATH}`)
  await rm(JIB_NGINX_INCLUDE_PATH, { force: true })

  try {
    const entries = await readdir(ctx.paths.nginxDir)
    for (const entry of entries) {
      const path = `${ctx.paths.nginxDir}/${entry}`
      await rm(path, { recursive: true, force: true })
      log.info(`removed ${path}`)
    }
  } catch {
    // Missing dir is fine.
  }
}
