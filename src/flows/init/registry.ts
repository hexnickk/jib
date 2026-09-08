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
import type { Config } from '@jib/config'
import { ingressInstall, manifest as ingressManifest, ingressUninstall } from '@jib/ingress'
import { cloudflaredRunSetup } from '../cloudflared/setup.ts'
import type { FirstPartyModule } from './types.ts'

/** Bundled modules and their install, setup, and uninstall hooks. */
const MODULES: readonly FirstPartyModule[] = [
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
    setup: ({ paths }) => cloudflaredRunSetup(paths),
    uninstall: cloudflaredUninstallResult,
  },
]

/** Optional modules where config.modules[name] === true. */
export function initInstalledOptionalModules(config: Config): FirstPartyModule[] {
  return MODULES.filter(
    (mod) => !mod.manifest.required && config.modules?.[mod.manifest.name] === true,
  )
}

/** Optional modules the user has never been asked about. */
export function initUnseenOptionalModules(config: Config): FirstPartyModule[] {
  const modules = config.modules ?? {}
  return MODULES.filter((mod) => !mod.manifest.required && !(mod.manifest.name in modules))
}
