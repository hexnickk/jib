import type { ModuleManifest } from '@jib/core'

/**
 * Cloudflare Tunnel ingress routing. A long-running NATS operator that
 * handles `cmd.cloudflare.domain.add` / `cmd.cloudflare.domain.remove` by
 * writing DNS records and tunnel ingress rules via the Cloudflare REST API.
 *
 * Not `requiresRoot`: every call goes through the Cloudflare API from user
 * context. The matching `modules/cloudflared` provides the daemon that
 * actually terminates tunnels and IS root-only.
 */
const manifest: ModuleManifest = {
  name: 'cloudflare',
  description: 'Cloudflare Tunnel ingress routing',
}

export default manifest
