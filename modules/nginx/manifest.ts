import type { ModuleManifest } from '@jib/core'

/**
 * Nginx reverse-proxy module. A long-running bus operator that wraps the
 * ingress-owned nginx adapter and applies claims/releases on the host.
 */
const manifest: ModuleManifest = {
  name: 'nginx',
  required: true,
  description: 'Nginx reverse proxy',
}

export default manifest
