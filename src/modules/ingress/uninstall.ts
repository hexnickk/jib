import type { JibError } from '@jib/errors'
import { ingressDefaultBackend } from './backends/index.ts'
import type { IngressHook } from './backends/types.ts'

/** Runs the default backend uninstall hook when the backend provides one. */
export const ingressUninstall: IngressHook = async (ctx): Promise<JibError | undefined> => {
  return await ingressDefaultBackend().uninstall?.(ctx)
}
