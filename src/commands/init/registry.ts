import type { Config } from '@jib/config'
import { promptConfirm } from '@jib/tui'
import {
  type FirstPartyModule,
  allModules,
  optionalModules,
  requiredModules,
  resolveModules,
} from '../../module-registry.ts'

export type ModLike = FirstPartyModule

export const ALL_MODULES: readonly ModLike[] = allModules()
export { optionalModules, requiredModules, resolveModules }

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
