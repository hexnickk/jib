import type { Config } from '@jib/config'
import type { Logger } from '@jib/logging'
import type { Paths } from '@jib/paths'

export interface ModuleManifest {
  name: string
  required?: boolean
  description?: string
}

export interface InitContext {
  config: Config
  logger: Logger
  paths: Paths
}

export type ModuleHook = (ctx: InitContext) => Promise<void>

export interface FirstPartyModule {
  manifest: ModuleManifest
  install?: ModuleHook
  uninstall?: ModuleHook
}
