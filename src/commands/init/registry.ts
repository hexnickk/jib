import * as cloudflaredMod from '@jib-module/cloudflared'
import * as deployerMod from '@jib-module/deployer'
import * as githubMod from '@jib-module/github'
import * as gitsitterMod from '@jib-module/gitsitter'
import * as natsMod from '@jib-module/nats'
import * as nginxMod from '@jib-module/nginx'
import type { Config } from '@jib/config'
import type { ModuleContext, ModuleManifest } from '@jib/core'
import { promptMultiSelect } from '@jib/tui'

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

/** Prompt user to select from a list of optional modules. */
export async function promptOptionalModules(
  candidates: ModLike[],
): Promise<{ selected: string[]; declined: string[] }> {
  if (candidates.length === 0) return { selected: [], declined: [] }

  const chosen = await promptMultiSelect<string>({
    message: 'Optional modules (space to toggle, enter to confirm)',
    options: candidates.map((m) => ({
      value: m.manifest.name,
      label: m.manifest.description ?? m.manifest.name,
    })),
  })

  const chosenSet = new Set(chosen)
  const selected = candidates
    .filter((m) => chosenSet.has(m.manifest.name))
    .map((m) => m.manifest.name)
  const declined = candidates
    .filter((m) => !chosenSet.has(m.manifest.name))
    .map((m) => m.manifest.name)
  return { selected, declined }
}
