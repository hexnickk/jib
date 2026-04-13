import type { Config } from '@jib/config'
import {
  type FirstPartyModule,
  initAllModules,
  initOptionalModules,
  initRequiredModules,
  initResolveModules,
} from './module-registry.ts'

export type ModLike = FirstPartyModule

export const INIT_ALL_MODULES: readonly ModLike[] = initAllModules()
export { initOptionalModules, initRequiredModules, initResolveModules }

/** Optional modules where config.modules[name] === true. */
export function initInstalledOptionalModules(config: Config): ModLike[] {
  return initOptionalModules().filter((m) => config.modules?.[m.manifest.name] === true)
}

/** Optional modules the user has never been asked about. */
export function initUnseenOptionalModules(config: Config): ModLike[] {
  const mods = config.modules ?? {}
  return initOptionalModules().filter((m) => !(m.manifest.name in mods))
}

/** Returns the names of optional modules that still need an explicit choice. */
export function initPendingOptionalModuleNames(config: Config): string[] {
  return initUnseenOptionalModules(config).map((mod) => mod.manifest.name)
}

/** Formats optional module names and descriptions for the init intro note. */
export function initDescribeModules(modules: ModLike[]): string[] {
  return modules.map(
    (mod) => `${mod.manifest.name}: ${mod.manifest.description ?? mod.manifest.name}`,
  )
}
