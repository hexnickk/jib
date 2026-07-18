import { readdir, rm } from 'node:fs/promises'
import { type JibError, errorsToJibError } from '@jib/errors'
import type { IngressHook } from '../types.ts'
import { JIB_NGINX_INCLUDE_PATH } from './install.ts'

/** Removes generated nginx config and the jib include snippet. */
export const ingressUninstall: IngressHook = async (ctx): Promise<JibError | undefined> => {
  const log = ctx.logger
  try {
    log.info(`removing ${JIB_NGINX_INCLUDE_PATH}`)
    await rm(JIB_NGINX_INCLUDE_PATH, { force: true })

    let entries: string[]
    try {
      entries = await readdir(ctx.paths.nginxDir)
    } catch (error) {
      if (isMissingPathError(error)) {
        return undefined
      }
      return errorsToJibError(error)
    }
    for (const entry of entries) {
      const path = `${ctx.paths.nginxDir}/${entry}`
      await rm(path, { recursive: true, force: true })
      log.info(`removed ${path}`)
    }
    return undefined
  } catch (error) {
    return errorsToJibError(error)
  }
}

/** Checks whether an operating-system error represents an absent path. */
function isMissingPathError(error: unknown): boolean {
  return !!error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT'
}
