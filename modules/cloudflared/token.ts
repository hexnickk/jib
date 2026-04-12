/**
 * Extracts the tunnel token from user input. Accepts any of:
 *   - The raw token string (e.g. `eyJhIjoiNz...`)
 *   - `sudo cloudflared service install <token>`
 *   - `cloudflared service install <token>`
 *   - `cloudflared tunnel run --token <token>`
 *
 * Returns the trimmed token, or empty string if input is blank.
 */
export function cloudflaredExtractTunnelToken(raw: string): string {
  const trimmed = raw.trim()
  if (!trimmed) return ''

  const install = /(?:sudo\s+)?cloudflared\s+service\s+install\s+(.+)$/i.exec(trimmed)
  if (install?.[1]) return install[1].trim()

  const run = /cloudflared\s+tunnel\s+run\s+--token\s+(.+)$/i.exec(trimmed)
  if (run?.[1]) return run[1].trim()

  if (/^\s*(?:sudo\s+)?cloudflared\s/i.test(trimmed)) return ''
  return trimmed
}
