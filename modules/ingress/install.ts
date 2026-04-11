import { defaultIngressBackend } from './backends/index.ts'
import type { IngressHook } from './backends/types.ts'

export const install: IngressHook = async (ctx) => {
  await defaultIngressBackend().install?.(ctx)
}
