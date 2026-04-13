import { runCloudflaredSetup } from '../cloudflared/setup.ts'
import type { InitContext } from './types.ts'

type ModuleSetup = (ctx: InitContext) => Promise<boolean>

const SETUPS: Readonly<Record<string, ModuleSetup>> = {
  cloudflared: ({ paths }) => runCloudflaredSetup(paths),
}

export function initResolveModuleSetup(name: string): ModuleSetup | undefined {
  return SETUPS[name]
}
