import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { DEFAULT_INGRESS_MAX_BODY_SIZE } from '@jib/config'
import type { Config } from '@jib/config'
import type { Paths } from '@jib/paths'
import { NginxIngressReloadError } from '../../errors.ts'
import { type ExecFn, ingressGetExec } from '../../exec.ts'

const GLOBAL_CONF_FILENAME = '00-jib-ingress.conf'
const NGINX_BIN = '/usr/sbin/nginx'

/** Writes the nginx global ingress settings snippet under the managed nginx dir. */
export async function ingressWriteNginxGlobalConfig(
  nginxDir: string,
  config: Config,
): Promise<void> {
  await mkdir(nginxDir, { recursive: true, mode: 0o755 })
  await writeFile(
    join(nginxDir, GLOBAL_CONF_FILENAME),
    `# Managed by jib (src/modules/ingress/backends/nginx) — do not edit.
client_max_body_size ${nginxMaxBodySize(config)};
`,
    { mode: 0o644 },
  )
}

/** Applies config-backed nginx ingress settings and reloads nginx. */
export async function ingressApplyNginxConfig(
  paths: Paths,
  config: Config,
  exec: ExecFn = ingressGetExec(),
): Promise<undefined | Error> {
  await ingressWriteNginxGlobalConfig(paths.nginxDir, config)
  return await reloadNginx(exec)
}

function nginxMaxBodySize(config: Config): string {
  return config.ingress?.max_body_size ?? DEFAULT_INGRESS_MAX_BODY_SIZE
}

async function reloadNginx(exec: ExecFn): Promise<NginxIngressReloadError | undefined> {
  const test = await exec(['sudo', NGINX_BIN, '-t'])
  if (!test.ok) return new NginxIngressReloadError(`nginx -t failed: ${test.stderr.trim()}`)
  const reload = await exec(['sudo', 'systemctl', 'reload', 'nginx'])
  if (!reload.ok) {
    return new NginxIngressReloadError(`systemctl reload nginx failed: ${reload.stderr.trim()}`)
  }
  return undefined
}
