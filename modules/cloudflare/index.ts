import type { Config } from '@jib/config'
import type { SetupHook } from '@jib/core'

export { default as manifest } from './manifest.ts'
export { install } from './install.ts'
export { uninstall } from './uninstall.ts'
export { default as cli } from './cli.ts'
export { start } from './start.ts'

/**
 * TODO(stage-4): delete this stub + the src/setup-hooks.ts importer.
 * Stage 3 converts cloudflare into a NATS operator that handles only
 * root-domain wildcard setup, so per-app hooks no longer exist. The empty
 * object keeps `src/setup-hooks.ts` compiling during the stage 3→4 overlap.
 */
export const setupHooks: SetupHook<Config> = {}
