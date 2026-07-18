import {
  cloudflaredInstallResult,
  manifest as cloudflaredManifest,
  cloudflaredUninstallResult,
} from '@jib-module/cloudflared'
import {
  watcherInstallResult,
  manifest as watcherManifest,
  watcherUninstallResult,
} from '@jib-module/watcher'
import { ingressInstall, manifest as ingressManifest, ingressUninstall } from '@jib/ingress'
import type { FirstPartyModule } from './types.ts'
export type { FirstPartyModule } from './types.ts'

/** Static first-party module registry for bundled CLI visibility. */
export const MODULES: readonly FirstPartyModule[] = [
  {
    manifest: watcherManifest,
    install: watcherInstallResult,
    uninstall: watcherUninstallResult,
  },
  {
    manifest: ingressManifest,
    install: ingressInstall,
    uninstall: ingressUninstall,
  },
  {
    manifest: cloudflaredManifest,
    install: cloudflaredInstallResult,
    uninstall: cloudflaredUninstallResult,
  },
]

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
