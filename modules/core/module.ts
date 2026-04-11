import type { ModuleContext } from './context.ts'

/** Static metadata exported by every module's `manifest.ts`. */
export interface ModuleManifest {
  name: string
  required?: boolean
  description?: string
}

export type InstallFn<C = unknown> = (ctx: ModuleContext<C>) => Promise<void>

/** Contract implemented by modules that provide live git credentials. */
export interface GitAuthProvider<C = unknown> {
  name: string
  credentialsFor: (
    ctx: ModuleContext<C>,
    repo: string,
  ) => Promise<{ username: string; password: string } | null>
}

/**
 * Shape a module file tree conforms to once resolved by the loader.
 * Each field mirrors a convention file (`install.ts`, `manifest.ts`, ...).
 */
export interface Module<C = unknown> {
  manifest: ModuleManifest
  install?: InstallFn<C>
  uninstall?: InstallFn<C>
  gitAuthProvider?: GitAuthProvider<C>
}
