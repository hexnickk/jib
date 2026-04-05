import type { CommandDef } from 'citty'
import type { ModuleContext } from './context.ts'

/** Static metadata exported by every module's `manifest.ts`. */
export interface ModuleManifest {
  name: string
  deps?: string[]
  requiresRoot?: boolean
  description?: string
}

export type InstallFn<C = unknown> = (ctx: ModuleContext<C>) => Promise<void>
export type StartFn<C = unknown> = (ctx: ModuleContext<C>) => Promise<void>

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
  gitAuthProvider?: GitAuthProvider<C>
}

/** A module plus bookkeeping the loader attaches (e.g. source path). */
export interface LoadedModule<C = unknown> extends Module<C> {
  path: string
}
