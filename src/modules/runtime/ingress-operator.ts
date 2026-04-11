import type { Paths } from '@jib/core'
import { createIngressOperator as createDefaultIngressOperator } from '@jib/ingress'

export function createIngressOperator(paths: Paths) {
  return createDefaultIngressOperator(paths)
}
