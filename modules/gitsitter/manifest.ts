import type { ModuleManifest } from '@jib/core'

/**
 * gitsitter is the sole owner of every git operation in jib. It runs as a
 * long-lived systemd service: polls configured repos, handles
 * `cmd.repo.{prepare,remove}` over NATS, and on autodeploy emits `cmd.deploy`
 * directly so the CLI is never in the loop.
 */
const manifest: ModuleManifest = {
  name: 'gitsitter',
  requiresRoot: true,
  description: 'Git polling + repo ops',
}

export default manifest
