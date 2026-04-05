import type { ModuleManifest } from '@jib/core'

/**
 * Deploy orchestrator. Listens on `cmd.deploy|rollback|resume` and emits the
 * corresponding `evt.*.success|failure|progress`. Trusts the workdir passed
 * in the command — deployer never imports git or gitsitter so the constraint
 * that only gitsitter touches git stays intact.
 */
const manifest: ModuleManifest = {
  name: 'deployer',
  requiresRoot: true,
  description: 'Deploy orchestrator',
}

export default manifest
