import type { ModuleManifest } from '@jib/core'

/**
 * HTTP webhook receiver. Accepts GitHub push events, verifies HMAC-SHA256
 * signatures against a shared secret, and republishes them as `cmd.repo.prepare`
 * / `cmd.deploy` on the bus — the same chain a manual `jib deploy` uses. The
 * receiver is the state machine for webhook-triggered deploys, matching how
 * gitsitter acts as the state machine for poll-triggered deploys.
 */
const manifest: ModuleManifest = {
  name: 'webhook',
  requiresRoot: true,
  description: 'HTTP webhook receiver',
}

export default manifest
