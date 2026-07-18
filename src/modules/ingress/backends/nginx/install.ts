import { readFile, writeFile } from 'node:fs/promises'
import { InternalError, type JibError, errorsToJibError } from '@jib/errors'
import { ingressGetExec } from '../../exec.ts'
import type { IngressHook } from '../types.ts'
import { ingressWriteNginxGlobalConfig } from './config.ts'

const JIB_INCLUDE_PATH = '/etc/nginx/conf.d/jib.conf'

/** Renders the nginx include snippet for jib-managed global and per-app configuration. */
function includeSnippet(nginxDir: string): string {
  return `# Managed by jib (src/modules/ingress/backends/nginx) — do not edit.
include ${nginxDir}/*.conf;
include ${nginxDir}/*/*.conf;
`
}

/** Installs nginx support files and reloads systemd if nginx is available. */
export const ingressInstall: IngressHook = async (ctx): Promise<JibError | undefined> => {
  const log = ctx.logger
  const exec = ingressGetExec()
  try {
    const which = await exec(['which', 'nginx'])
    if (!which.ok) {
      log.info('nginx not found, attempting apt install')
      const apt = await exec(['apt-get', 'install', '-y', 'nginx'])
      if (!apt.ok) {
        log.warn(`could not install nginx automatically: ${apt.stderr.trim()}`)
        log.warn('continuing — manage nginx yourself and re-run install if needed')
      }
    }

    log.info(`creating ${ctx.paths.nginxDir}`)
    const globalConfigError = await ingressWriteNginxGlobalConfig(ctx.paths.nginxDir, ctx.config)
    if (globalConfigError) {
      return globalConfigError
    }

    const desired = includeSnippet(ctx.paths.nginxDir)
    let existing = ''
    try {
      existing = await readFile(JIB_INCLUDE_PATH, 'utf8')
    } catch (error) {
      if (!isMissingPathError(error)) {
        return errorsToJibError(error)
      }
    }
    if (existing === desired) {
      log.info(`${JIB_INCLUDE_PATH} already current`)
    } else {
      log.info(`writing ${JIB_INCLUDE_PATH}`)
      await writeFile(JIB_INCLUDE_PATH, desired, { mode: 0o644 })
    }

    log.info('systemctl daemon-reload')
    const reload = await exec(['sudo', 'systemctl', 'daemon-reload'])
    if (!reload.ok) {
      return new InternalError(`systemctl daemon-reload failed: ${reload.stderr.trim()}`)
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

export const JIB_NGINX_INCLUDE_PATH = JIB_INCLUDE_PATH
