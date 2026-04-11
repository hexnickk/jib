import type { Config } from '@jib/config'
import type { InstallFn, Paths } from '@jib/core'
import type { IngressOperator } from '../types.ts'

export interface IngressBackend {
  readonly name: string
  createOperator(paths: Paths): IngressOperator
  install?: InstallFn<Config>
  uninstall?: InstallFn<Config>
}
