import { rm } from 'node:fs/promises'
import { join } from 'node:path'
import type { Logger } from '@jib/logging'
import type { Paths } from '@jib/paths'
import { SERVICE_NAME, UNIT_PATH } from './templates.ts'

interface CloudflaredContext {
  logger: Logger
  paths: Paths
}

interface UninstallDeps {
  serviceName?: string
  unitPath?: string
  disableNow?: () => Promise<unknown>
  daemonReload?: () => Promise<unknown>
}

/** Stops the unit, removes the unit file + compose file. Leaves the dir. */
export const uninstall = async (
  ctx: CloudflaredContext,
  deps: UninstallDeps = {},
): Promise<void> => {
  const log = ctx.logger
  const dir = ctx.paths.cloudflaredDir
  const serviceName = deps.serviceName ?? SERVICE_NAME
  const unitPath = deps.unitPath ?? UNIT_PATH
  const disableNow =
    deps.disableNow ?? (() => Bun.$`sudo systemctl disable --now ${serviceName}`.nothrow().quiet())
  const daemonReload =
    deps.daemonReload ?? (() => Bun.$`sudo systemctl daemon-reload`.nothrow().quiet())

  log.info(`systemctl disable --now ${serviceName}`)
  await disableNow()

  log.info(`removing ${unitPath}`)
  await rm(unitPath, { force: true })

  const composePath = join(dir, 'docker-compose.yml')
  log.info(`removing ${composePath}`)
  await rm(composePath, { force: true })

  log.info('systemctl daemon-reload')
  await daemonReload()
}
