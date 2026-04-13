import { ingressDefaultBackend } from './backends/index.ts'
import type { IngressHook } from './backends/types.ts'

/** Runs the default backend uninstall hook when the backend provides one. */
export const ingressUninstall: IngressHook = async (ctx) => {
  await ingressDefaultBackend().uninstall?.(ctx)
}
