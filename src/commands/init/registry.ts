import * as cloudflaredMod from '@jib-module/cloudflared'
import * as deployerMod from '@jib-module/deployer'
import * as githubMod from '@jib-module/github'
import * as gitsitterMod from '@jib-module/gitsitter'
import * as natsMod from '@jib-module/nats'
import * as nginxMod from '@jib-module/nginx'
import type { Config } from '@jib/config'
import type { ModuleContext, ModuleManifest } from '@jib/core'
import { promptConfirm } from '@jib/tui'

export interface ModLike {
  manifest: ModuleManifest
  install?: (ctx: ModuleContext<Config>) => Promise<void>
  uninstall?: (ctx: ModuleContext<Config>) => Promise<void>
  setup?: (ctx: ModuleContext<Config>) => Promise<void>
}

/** All modules in dependency order. Static imports for bun build --compile. */
export const ALL_MODULES: ModLike[] = [
  natsMod,
  deployerMod,
  gitsitterMod,
  nginxMod,
  cloudflaredMod,
  githubMod,
]

export function requiredModules(): ModLike[] {
  return ALL_MODULES.filter((m) => m.manifest.required)
}

export function optionalModules(): ModLike[] {
  return ALL_MODULES.filter((m) => !m.manifest.required)
}

export function resolveModules(names: string[]): ModLike[] {
  const set = new Set(names)
  return ALL_MODULES.filter((m) => set.has(m.manifest.name))
}

/** Optional modules where config.modules[name] === true. */
export function installedOptionalModules(config: Config): ModLike[] {
  return optionalModules().filter((m) => config.modules?.[m.manifest.name] === true)
}

/** Optional modules the user has never been asked about. */
export function unseenOptionalModules(config: Config): ModLike[] {
  const mods = config.modules ?? {}
  return optionalModules().filter((m) => !(m.manifest.name in mods))
}

export function describeModules(modules: ModLike[]): string[] {
  return modules.map(
    (mod) => `${mod.manifest.name}: ${mod.manifest.description ?? mod.manifest.name}`,
  )
}

/** Prompt user to select from a list of optional modules. */
export async function promptOptionalModules(
  candidates: ModLike[],
): Promise<{ selected: string[]; declined: string[] }> {
  if (candidates.length === 0) return { selected: [], declined: [] }

  const selected: string[] = []
  const declined: string[] = []

  for (const mod of candidates) {
    const enabled = await promptConfirm({
      message:
        `Enable optional module "${mod.manifest.name}"? ${mod.manifest.description ?? ''}`.trim(),
      initialValue: false,
    })
    if (enabled) selected.push(mod.manifest.name)
    else declined.push(mod.manifest.name)
  }

  return { selected, declined }
}
