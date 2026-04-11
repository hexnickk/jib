import type { Config } from '@jib/config'
import { promptConfirm } from '@jib/tui'
import {
  type FirstPartyModule,
  allModules,
  optionalModules,
  requiredModules,
  resolveModules,
} from './module-registry.ts'

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

export function pendingOptionalModuleNames(config: Config): string[] {
  return unseenOptionalModules(config).map((mod) => mod.manifest.name)
}

export function describeModules(modules: ModLike[]): string[] {
  return modules.map(
    (mod) => `${mod.manifest.name}: ${mod.manifest.description ?? mod.manifest.name}`,
  )
}

/** Prompt for a single optional module so init can configure them one by one. */
export function promptOptionalModule(mod: ModLike): Promise<boolean> {
  return promptConfirm({
    message:
      `Enable optional module "${mod.manifest.name}"? ${mod.manifest.description ?? ''}`.trim(),
    initialValue: false,
  })
}
