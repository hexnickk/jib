import type { Bus } from '@jib/bus'
import type { Logger, Paths } from '@jib/core'
import {
  type CertExistsFn,
  type ExecFn,
  createNginxIngressOperator,
  registerIngressHandlers,
} from '@jib/ingress'

export type { CertExistsFn } from '@jib/ingress'

export interface NginxOperatorDeps {
  paths: Paths
  log: Logger
  exec?: ExecFn
  certExists?: CertExistsFn
}

export function registerNginxHandlers(bus: Bus, deps: NginxOperatorDeps): () => void {
  return registerIngressHandlers(
    bus,
    createNginxIngressOperator({
      nginxDir: deps.paths.nginxDir,
      ...(deps.exec ? { exec: deps.exec } : {}),
      ...(deps.certExists ? { certExists: deps.certExists } : {}),
    }),
    deps.log,
  )
}
