import type { CommandDef } from 'citty'
import type { ModuleContext } from './context.ts'

/** Static metadata exported by every module's `manifest.ts`. */
export interface ModuleManifest {
  name: string
  deps?: string[]
  requiresRoot?: boolean
  description?: string
  /**
   * Install + setup-hook ordering. Lower numbers run first on add
   * (`install`, `onAppAdd`); higher numbers run first on removal
   * (`uninstall`, `onAppRemove`). Default is 100. Used to enforce
   * cloudflare-before-nginx on add and nginx-before-cloudflare on remove.
   */
  installOrder?: number
}

export type InstallFn<C = unknown> = (ctx: ModuleContext<C>) => Promise<void>
export type StartFn<C = unknown> = (ctx: ModuleContext<C>) => Promise<void>

/**
 * A hook that participates in multi-module lifecycle events
 * (e.g. adding an app runs every module's `onAppAdd`).
 */
export interface SetupHook<C = unknown> {
  onAppAdd?: (ctx: ModuleContext<C>, app: string) => Promise<void>
  onAppRemove?: (ctx: ModuleContext<C>, app: string) => Promise<void>
}

/** Contract implemented by modules that provide git credentials to gitsitter. */
export interface GitAuthProvider<C = unknown> {
  name: string
  credentialsFor: (
    ctx: ModuleContext<C>,
    repo: string,
  ) => Promise<{ username: string; password: string } | null>
}

/**
 * Shape a module file tree conforms to once resolved by the loader.
 * Each field mirrors a convention file (`install.ts`, `start.ts`, ...).
 */
export interface Module<C = unknown> {
  manifest: ModuleManifest
  install?: InstallFn<C>
  uninstall?: InstallFn<C>
  start?: StartFn<C>
  cli?: CommandDef[]
  setupHooks?: SetupHook<C>
  gitAuthProvider?: GitAuthProvider<C>
}

/** A module plus bookkeeping the loader attaches (e.g. source path). */
export interface LoadedModule<C = unknown> extends Module<C> {
  path: string
}
