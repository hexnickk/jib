import type { Config } from '@jib/config'
import { type ModuleContext, type Paths, createLogger } from '@jib/core'
import { type ServiceStatus, collectServices } from '@jib/state'
import { installedOptionalModules, requiredModules, resolveModules } from './registry.ts'

export interface RefreshExistingInstallDeps {
  collectServices?: (hasTunnel: boolean) => Promise<ServiceStatus[]>
  reinstallModules?: (names: string[], ctx: ModuleContext<Config>) => Promise<void>
  restartService?: (name: string) => Promise<void>
}

export function installedModuleNames(config: Config): string[] {
  return [
    ...requiredModules().map((mod) => mod.manifest.name),
    ...installedOptionalModules(config).map((mod) => mod.manifest.name),
  ]
}

async function reinstallInstalledModules(
  names: string[],
  ctx: ModuleContext<Config>,
): Promise<void> {
  const mods = resolveModules(names)
  for (const mod of mods) {
    if (!mod.install) continue
    await mod.install(ctx)
  }
}

async function restartManagedService(name: string): Promise<void> {
  await Bun.$`sudo systemctl restart ${name}`.quiet().nothrow()
}

export async function refreshExistingInstall(
  config: Config,
  paths: Paths,
  { reinstallUnits }: { reinstallUnits: boolean },
  deps: RefreshExistingInstallDeps = {},
): Promise<number> {
  if (reinstallUnits) {
    const ctx: ModuleContext<Config> = { config, logger: createLogger('init'), paths }
    const reinstall = deps.reinstallModules ?? reinstallInstalledModules
    await reinstall(installedModuleNames(config), ctx)
  }

  const services = await (deps.collectServices ?? collectServices)(
    config.modules?.cloudflared === true,
  )
  const restart = deps.restartService ?? restartManagedService
  let restarted = 0
  for (const service of services) {
    if (!service.active) continue
    await restart(service.name)
    restarted++
  }
  return restarted
}
