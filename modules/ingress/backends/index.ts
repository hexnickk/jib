import type { Paths } from '@jib/core'
import { nginxBackend } from './nginx/index.ts'
import type { IngressBackend } from './types.ts'

const DEFAULT_BACKEND: IngressBackend = nginxBackend

export function defaultIngressBackend(): IngressBackend {
  return DEFAULT_BACKEND
}

export function createIngressOperator(paths: Paths) {
  return DEFAULT_BACKEND.createOperator(paths)
}
