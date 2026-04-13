import type { Paths } from '@jib/paths'
import type { IngressOperator } from '../types.ts'
import { nginxBackend } from './nginx/index.ts'
import type { IngressBackend } from './types.ts'

const DEFAULT_BACKEND: IngressBackend = nginxBackend

/** Returns the default ingress backend implementation. */
export function ingressDefaultBackend(): IngressBackend {
  return DEFAULT_BACKEND
}

/** Creates the ingress operator for the default backend. */
export function ingressCreateOperator(paths: Paths): IngressOperator {
  return DEFAULT_BACKEND.createOperator(paths)
}
