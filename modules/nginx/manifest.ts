import type { ModuleManifest } from '@jib/core'

/**
 * Nginx reverse-proxy module. Installs nginx and the jib include snippet so
 * CLI flows can apply ingress claims directly on the host.
 */
const manifest: ModuleManifest = {
  name: 'nginx',
  required: true,
  description: 'Nginx reverse proxy',
}

export default manifest
