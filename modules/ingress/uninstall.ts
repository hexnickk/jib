import { defaultIngressBackend } from './backends/index.ts'
import type { IngressHook } from './backends/types.ts'

export const uninstall: IngressHook = async (ctx) => {
  await defaultIngressBackend().uninstall?.(ctx)
}
