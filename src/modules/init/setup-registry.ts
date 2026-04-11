import { runCloudflaredSetup } from '../cloudflared/setup.ts'
import type { ModuleHook } from './types.ts'

type ModuleSetup = ModuleHook

const SETUPS: Readonly<Record<string, ModuleSetup>> = {
  cloudflared: ({ paths }) => runCloudflaredSetup(paths),
}

export function resolveModuleSetup(name: string): ModuleSetup | undefined {
  return SETUPS[name]
}
