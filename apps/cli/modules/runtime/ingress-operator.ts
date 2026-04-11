import type { Paths } from '@jib/core'
import { createNginxIngressOperator } from '@jib/ingress'

export function createIngressOperator(paths: Paths) {
  return createNginxIngressOperator({ nginxDir: paths.nginxDir })
}
