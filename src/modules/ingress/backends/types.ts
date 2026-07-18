import type { Config } from '@jib/config'
import type { JibError } from '@jib/errors'
import type { Logger } from '@jib/logging'
import type { Paths } from '@jib/paths'
import type { IngressOperator } from '../types.ts'

export interface IngressInstallContext {
  config: Config
  logger: Logger
  paths: Paths
}

/** Result-style lifecycle hook implemented by an ingress backend. */
export type IngressHook = (ctx: IngressInstallContext) => Promise<JibError | undefined>

export interface IngressBackend {
  readonly name: string
  createOperator(paths: Paths): IngressOperator
  install?: IngressHook
  uninstall?: IngressHook
}
