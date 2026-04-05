import type { ModuleManifest } from '@jib/core'

/**
 * Opt-in Cloudflare Tunnel daemon. Runs the `cloudflared` container via
 * a systemd-managed docker-compose so tunnels survive reboots. The tunnel
 * token lives in a secrets file loaded via `env_file:` — never mounted as
 * a volume (see CLAUDE.md). Route/DNS management lives in `modules/cloudflare`.
 */
const manifest: ModuleManifest = {
  name: 'cloudflared',
  requiresRoot: true,
  description: 'Cloudflare Tunnel daemon (optional)',
}

export default manifest
