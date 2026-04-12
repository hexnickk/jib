import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { Logger } from '@jib/logging'
import { type Paths, credsPath } from '@jib/paths'
import { CloudflaredInstallError, cloudflaredWrapError } from './errors.ts'
import {
  CLOUDFLARED_UNIT_PATH,
  cloudflaredComposeYaml,
  cloudflaredSystemdUnit,
} from './templates.ts'

interface CloudflaredContext {
  logger: Logger
  paths: Paths
}

interface CloudflaredInstallDeps {
  composeYaml?: typeof cloudflaredComposeYaml
  systemdUnit?: typeof cloudflaredSystemdUnit
  unitPath?: string
  daemonReload?: () => Promise<unknown>
}

/**
 * Writes the compose file + systemd unit under `$JIB_ROOT/cloudflared/` but
 * does NOT enable or start the service. Module install hooks still throw on
 * failure because the init hook contract is `Promise<void>`.
 */
export async function cloudflaredInstall(
  ctx: CloudflaredContext,
  deps: CloudflaredInstallDeps = {},
): Promise<void> {
  try {
    const log = ctx.logger
    const dir = ctx.paths.cloudflaredDir
    const tunnelEnvPath = credsPath(ctx.paths, 'cloudflare', 'tunnel.env')
    const vars = { cloudflaredDir: dir, tunnelEnvPath }
    const renderCompose = deps.composeYaml ?? cloudflaredComposeYaml
    const renderUnit = deps.systemdUnit ?? cloudflaredSystemdUnit
    const unitPath = deps.unitPath ?? CLOUDFLARED_UNIT_PATH
    const daemonReload = deps.daemonReload ?? (() => Bun.$`sudo systemctl daemon-reload`.quiet())

    log.info(`creating ${dir}`)
    await mkdir(dir, { recursive: true, mode: 0o755 })

    const composePath = join(dir, 'docker-compose.yml')
    log.info(`writing ${composePath}`)
    await writeFile(composePath, renderCompose(vars), { mode: 0o644 })

    log.info(`writing ${unitPath}`)
    await writeFile(unitPath, renderUnit(vars), { mode: 0o644 })

    log.info('systemctl daemon-reload')
    await daemonReload()
  } catch (error) {
    throw cloudflaredWrapError(error, CloudflaredInstallError)
  }
}
