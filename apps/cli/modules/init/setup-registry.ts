import type { Config } from '@jib/config'
import type { ModuleContext } from '@jib/core'
import { runCloudflaredSetup } from '../cloudflared/setup.ts'

type ModuleSetup = (ctx: ModuleContext<Config>) => Promise<void>

const SETUPS: Readonly<Record<string, ModuleSetup>> = {
  cloudflared: ({ paths }) => runCloudflaredSetup(paths),
}

export function resolveModuleSetup(name: string): ModuleSetup | undefined {
  return SETUPS[name]
}
