import type { Config } from '@jib/config'
import type { Logger } from '@jib/logging'
import type { Paths } from '@jib/paths'
import type { IngressOperator } from '../types.ts'

export interface IngressInstallContext {
  config: Config
  logger: Logger
  paths: Paths
}

export type IngressHook = (ctx: IngressInstallContext) => Promise<void>

export interface IngressBackend {
  readonly name: string
  createOperator(paths: Paths): IngressOperator
  install?: IngressHook
  uninstall?: IngressHook
}
