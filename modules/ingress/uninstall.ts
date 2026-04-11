import type { Config } from '@jib/config'
import type { InstallFn } from '@jib/core'
import { defaultIngressBackend } from './backends/index.ts'

export const uninstall: InstallFn<Config> = async (ctx) => {
  await defaultIngressBackend().uninstall?.(ctx)
}
