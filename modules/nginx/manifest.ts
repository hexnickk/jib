import type { ModuleManifest } from '@jib/core'

/**
 * Nginx reverse-proxy module. A long-running NATS operator that owns
 * `<app>/<host>.conf` files under `$JIB_ROOT/nginx/` and reloads nginx in
 * response to `cmd.nginx.claim` / `cmd.nginx.release`.
 */
const manifest: ModuleManifest = {
  name: 'nginx',
  required: true,
  description: 'Nginx reverse proxy',
}

export default manifest
