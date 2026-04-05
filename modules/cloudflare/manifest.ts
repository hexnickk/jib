import type { ModuleManifest } from '@jib/core'

/**
 * Cloudflare Tunnel ingress routing. Writes DNS records and tunnel ingress
 * rules via the Cloudflare REST API whenever an app with a
 * `cloudflare-tunnel` domain is added or removed.
 *
 * Not `requiresRoot`: every call goes through the Cloudflare API from user
 * context. The matching `modules/cloudflared` provides the daemon that
 * actually terminates tunnels and IS root-only.
 *
 * `installOrder: 10` — must run BEFORE `modules/nginx` (20) on add (so
 * routes exist when nginx configs are written), and AFTER nginx on
 * removal (so tunnel routes linger until the nginx backend is gone).
 */
const manifest: ModuleManifest = {
  name: 'cloudflare',
  description: 'Cloudflare Tunnel ingress routing',
  installOrder: 10,
}

export default manifest
