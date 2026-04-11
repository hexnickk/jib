/**
 * Opt-in Cloudflare Tunnel daemon. Runs the `cloudflared` container via
 * a systemd-managed docker-compose so tunnels survive reboots. The tunnel
 * token lives in a secrets file loaded via `env_file:` — never mounted as
 * a volume (see CLAUDE.md).
 */
const manifest = {
  name: 'cloudflared',
  description: 'Cloudflare Tunnel daemon (optional)',
} satisfies { name: string; required?: boolean; description?: string }

export default manifest
