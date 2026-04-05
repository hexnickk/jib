import type { ModuleManifest } from '@jib/core'

/**
 * Nginx reverse-proxy module. Owns per-domain `<host>.conf` files under
 * `$JIB_ROOT/nginx/` and reloads nginx on app add/remove.
 *
 * `installOrder: 20` — runs AFTER `modules/cloudflare` (10) on add, and
 * BEFORE cloudflare on remove. Rationale: nginx serves the tunnel backend,
 * so tunnel routes should exist before nginx writes configs referring to
 * their hosts, and nginx configs should disappear before their tunnel
 * routes do.
 */
const manifest: ModuleManifest = {
  name: 'nginx',
  requiresRoot: true,
  description: 'Nginx reverse proxy',
  installOrder: 20,
}

export default manifest
