import * as cloudflaredMod from '@jib-module/cloudflared'
import * as watcherMod from '@jib-module/watcher'
import * as ingressMod from '@jib/ingress'
import type { FirstPartyModule } from './types.ts'
export type { FirstPartyModule } from './types.ts'

/** Static first-party module registry for bun build --compile visibility. */
export const MODULES: readonly FirstPartyModule[] = [watcherMod, ingressMod, cloudflaredMod]

export function initAllModules(
  registry: readonly FirstPartyModule[] = MODULES,
): readonly FirstPartyModule[] {
  return registry
}

export function initRequiredModules(
  registry: readonly FirstPartyModule[] = MODULES,
): FirstPartyModule[] {
  return registry.filter((mod) => mod.manifest.required)
}

export function initOptionalModules(
  registry: readonly FirstPartyModule[] = MODULES,
): FirstPartyModule[] {
  return registry.filter((mod) => !mod.manifest.required)
}

export function initResolveModules(
  names: readonly string[],
  registry: readonly FirstPartyModule[] = MODULES,
): FirstPartyModule[] {
  const wanted = new Set(names)
  return registry.filter((mod) => wanted.has(mod.manifest.name))
}
