import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { DEFAULT_INGRESS_MAX_BODY_SIZE } from '@jib/config'
import type { Config } from '@jib/config'
import { InternalError, type JibError } from '@jib/errors'
import type { Paths } from '@jib/paths'
import { type ExecFn, ingressGetExec } from '../../exec.ts'

const GLOBAL_CONF_FILENAME = '00-jib-ingress.conf'
const NGINX_BIN = '/usr/sbin/nginx'

/** Writes the nginx global ingress settings snippet under the managed nginx directory. */
export async function ingressWriteNginxGlobalConfig(
  nginxDir: string,
  config: Config,
): Promise<InternalError | undefined> {
  try {
    await mkdir(nginxDir, { recursive: true, mode: 0o755 })
    await writeFile(
      join(nginxDir, GLOBAL_CONF_FILENAME),
      `# Managed by jib (src/modules/ingress/backends/nginx) — do not edit.
client_max_body_size ${nginxMaxBodySize(config)};
`,
      { mode: 0o644 },
    )
    return undefined
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return new InternalError(`write nginx ingress config: ${message}`, { cause: error })
  }
}

/** Applies config-backed nginx ingress settings and reloads nginx. */
export async function ingressApplyNginxConfig(
  paths: Paths,
  config: Config,
  exec: ExecFn = ingressGetExec(),
): Promise<JibError | undefined> {
  const writeError = await ingressWriteNginxGlobalConfig(paths.nginxDir, config)
  if (writeError) {
    return writeError
  }
  return await reloadNginx(exec)
}

/** Reads the configured nginx request-body limit or its application default. */
function nginxMaxBodySize(config: Config): string {
  return config.ingress?.max_body_size ?? DEFAULT_INGRESS_MAX_BODY_SIZE
}

/** Validates then reloads nginx through the configured command runner. */
async function reloadNginx(exec: ExecFn): Promise<InternalError | undefined> {
  const test = await exec(['sudo', NGINX_BIN, '-t'])
  if (!test.ok) {
    return new InternalError(`nginx -t failed: ${test.stderr.trim()}`)
  }
  const reload = await exec(['sudo', 'systemctl', 'reload', 'nginx'])
  if (!reload.ok) {
    return new InternalError(`systemctl reload nginx failed: ${reload.stderr.trim()}`)
  }
  return undefined
}
