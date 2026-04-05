import type { ModuleManifest } from '@jib/core'

/**
 * GitHub authentication provider module. Ships the `jib github key|app ...`
 * CLI commands plus the pure helpers `modules/gitsitter` uses to mint live
 * credentials (deploy-key SSH command, GitHub App installation tokens).
 *
 * Not runnable — has no `start.ts`. Does not participate in setup hooks.
 */
const manifest: ModuleManifest = {
  name: 'github',
  description: 'GitHub deploy key + App authentication',
}

export default manifest
