import * as cloudflaredMod from '@jib-module/cloudflared'
import * as watcherMod from '@jib-module/watcher'
import type { Config } from '@jib/config'
import type { Module, ModuleManifest } from '@jib/core'
import * as ingressMod from '@jib/ingress'

export type FirstPartyModule = Module<Config> & {
  manifest: ModuleManifest & { name: string }
}

/** Static first-party module registry for bun build --compile visibility. */
export const MODULES: readonly FirstPartyModule[] = [watcherMod, ingressMod, cloudflaredMod]

export function allModules(
  registry: readonly FirstPartyModule[] = MODULES,
): readonly FirstPartyModule[] {
  return registry
}

export function requiredModules(
  registry: readonly FirstPartyModule[] = MODULES,
): FirstPartyModule[] {
  return registry.filter((mod) => mod.manifest.required)
}

export function optionalModules(
  registry: readonly FirstPartyModule[] = MODULES,
): FirstPartyModule[] {
  return registry.filter((mod) => !mod.manifest.required)
}

export function resolveModules(
  names: readonly string[],
  registry: readonly FirstPartyModule[] = MODULES,
): FirstPartyModule[] {
  const wanted = new Set(names)
  return registry.filter((mod) => wanted.has(mod.manifest.name))
}
