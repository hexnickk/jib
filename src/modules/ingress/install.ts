import { ingressDefaultBackend } from './backends/index.ts'
import type { IngressHook } from './backends/types.ts'

/** Runs the default backend install hook when the backend provides one. */
export const ingressInstall: IngressHook = async (ctx) => {
  await ingressDefaultBackend().install?.(ctx)
}
