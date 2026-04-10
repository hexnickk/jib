import { mkdir, readFile, writeFile } from 'node:fs/promises'
import type { InstallFn } from '@jib/core'
import { getExec } from '@jib/ingress'

/**
 * Jib-owned snippet that pulls every file under `$JIB_ROOT/nginx/` into the
 * running nginx config. Written to `/etc/nginx/conf.d/jib.conf` so most
 * distro packages pick it up automatically (Debian/Ubuntu's main nginx.conf
 * `include /etc/nginx/conf.d/*.conf;` the directory by default).
 */
const JIB_INCLUDE_PATH = '/etc/nginx/conf.d/jib.conf'

function includeSnippet(nginxDir: string): string {
  // The operator writes per-app subdirs (`<app>/<host>.conf`). The flat
  // `*.conf` glob is retained so operators can drop hand-written site
  // files directly under `$JIB_ROOT/nginx/` without a wrapper dir.
  return `# Managed by jib (modules/nginx) — do not edit.
include ${nginxDir}/*.conf;
include ${nginxDir}/*/*.conf;
`
}

/**
 * Ensures nginx is on the host (install via apt on debian-like systems if
 * missing; otherwise warn and continue — operator may own nginx themselves).
 * Creates `$JIB_ROOT/nginx/` and writes the jib include snippet into
 * nginx's conf.d directory if it isn't already present with the expected
 * content.
 */
export const install: InstallFn = async (ctx) => {
  const log = ctx.logger
  const exec = getExec()

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
  await mkdir(ctx.paths.nginxDir, { recursive: true, mode: 0o755 })

  const desired = includeSnippet(ctx.paths.nginxDir)
  let existing = ''
  try {
    existing = await readFile(JIB_INCLUDE_PATH, 'utf8')
  } catch {
    // Missing is expected on first install.
  }
  if (existing === desired) {
    log.info(`${JIB_INCLUDE_PATH} already current`)
  } else {
    log.info(`writing ${JIB_INCLUDE_PATH}`)
    await writeFile(JIB_INCLUDE_PATH, desired, { mode: 0o644 })
  }

  log.info('systemctl daemon-reload')
  await exec(['sudo', 'systemctl', 'daemon-reload'])
}

export const JIB_NGINX_INCLUDE_PATH = JIB_INCLUDE_PATH
