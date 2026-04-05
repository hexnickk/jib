import type { CommandDef } from 'citty'
import type { ModuleContext } from './context.ts'

/** Static metadata exported by every module's `manifest.ts`. */
export interface ModuleManifest {
  name: string
  deps?: string[]
  requiresRoot?: boolean
}

export type InstallFn = (ctx: ModuleContext) => Promise<void>
export type StartFn = (ctx: ModuleContext) => Promise<void>

/**
 * A hook that participates in multi-module lifecycle events
 * (e.g. adding an app runs every module's `onAppAdd`).
 */
export interface SetupHook {
  onAppAdd?: (ctx: ModuleContext, app: string) => Promise<void>
  onAppRemove?: (ctx: ModuleContext, app: string) => Promise<void>
}

/** Contract implemented by modules that provide git credentials to gitsitter. */
export interface GitAuthProvider {
  name: string
  credentialsFor: (
    ctx: ModuleContext,
    repo: string,
  ) => Promise<{ username: string; password: string } | null>
}

/**
 * Shape a module file tree conforms to once resolved by the loader.
 * Each field mirrors a convention file (`install.ts`, `start.ts`, ...).
 */
export interface Module {
  manifest: ModuleManifest
  install?: InstallFn
  uninstall?: InstallFn
  start?: StartFn
  cli?: CommandDef[]
  setupHooks?: SetupHook
  gitAuthProvider?: GitAuthProvider
}

/** A module plus bookkeeping the loader attaches (e.g. source path). */
export interface LoadedModule extends Module {
  path: string
}
