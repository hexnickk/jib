import type { ModuleManifest } from '@jib/core'

/**
 * GitHub authentication source module. Ships the `jib github key|app ...`
 * CLI commands plus the pure helpers the watcher uses to mint live
 * credentials (deploy-key SSH command, GitHub App installation tokens).
 *
 * Does not participate in setup hooks.
 */
const manifest: ModuleManifest = {
  name: 'github',
  description: 'GitHub deploy key + App authentication',
}

export default manifest
