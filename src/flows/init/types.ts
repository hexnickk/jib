import type { Config } from '@jib/config'
import type { JibError } from '@jib/errors'
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

/** Result-style lifecycle hook implemented by a first-party module. */
export type ModuleHook = (ctx: InitContext) => Promise<JibError | undefined>

export interface FirstPartyModule {
  manifest: ModuleManifest
  install?: ModuleHook
  uninstall?: ModuleHook
}
