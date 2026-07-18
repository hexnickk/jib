import type { JibError } from '@jib/errors'
import { ingressDefaultBackend } from './backends/index.ts'
import type { IngressHook } from './backends/types.ts'

/** Runs the default backend install hook when the backend provides one. */
export const ingressInstall: IngressHook = async (ctx): Promise<JibError | undefined> => {
  return await ingressDefaultBackend().install?.(ctx)
}
