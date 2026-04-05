import type { ModuleManifest } from '@jib/core'

/**
 * NATS message bus module. Required by every long-running jib service
 * (deployer, gitsitter). Installs a systemd unit that runs NATS via
 * docker-compose so it survives host reboots.
 */
const manifest: ModuleManifest = {
  name: 'nats',
  requiresRoot: true,
  description: 'NATS message bus (required by all services)',
}

export default manifest
