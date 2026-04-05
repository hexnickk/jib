import type { CloudflareClient, IngressRule } from './client.ts'

/**
 * Pure helpers for merging tunnel ingress rules. Extracted from `hooks.ts`
 * so the list-building logic is unit-testable without mocking the client.
 *
 * Invariants:
 *   - The `http_status:404` catch-all is always the LAST rule.
 *   - Wildcard (`*.host`) entries are treated as a pair with their bare host.
 *   - Existing rules for the same hostnames are replaced, not duplicated.
 */

const CATCH_ALL: IngressRule = { service: 'http_status:404' }

export function mergeAddRoutes(existing: IngressRule[], domains: string[]): IngressRule[] {
  const fresh = new Set<string>()
  for (const d of domains) {
    fresh.add(d)
    fresh.add(`*.${d}`)
  }
  const kept = existing.filter(
    (r) => r.service !== CATCH_ALL.service && (r.hostname === undefined || !fresh.has(r.hostname)),
  )
  const added: IngressRule[] = []
  for (const d of domains) {
    added.push({ hostname: d, service: 'http://localhost:80' })
    added.push({ hostname: `*.${d}`, service: 'http://localhost:80' })
  }
  return [...kept, ...added, CATCH_ALL]
}

export function mergeRemoveRoutes(existing: IngressRule[], domains: string[]): IngressRule[] {
  const drop = new Set<string>()
  for (const d of domains) {
    drop.add(d)
    drop.add(`*.${d}`)
  }
  const kept = existing.filter(
    (r) => r.service !== CATCH_ALL.service && (r.hostname === undefined || !drop.has(r.hostname)),
  )
  return [...kept, CATCH_ALL]
}

/**
 * Adds tunnel + DNS records for each domain. DNS failures are logged and
 * swallowed — we still want the tunnel routes to land even if the zone
 * lookup fails (operator may be running their own DNS).
 */
export async function addTunnelRoutes(
  client: CloudflareClient,
  accountId: string,
  tunnelId: string,
  domains: string[],
  log: { info: (m: string) => void; warn: (m: string) => void },
): Promise<void> {
  const cname = `${tunnelId}.cfargotunnel.com`
  for (const d of domains) {
    const zoneId = await client.findZoneId(d).catch(() => null)
    if (!zoneId) {
      log.warn(`no cloudflare zone for ${d} — add DNS manually`)
      continue
    }
    for (const name of [d, `*.${d}`]) {
      try {
        await client.createDNSRecord(zoneId, { type: 'CNAME', name, content: cname, proxied: true })
        log.info(`dns: ${name} -> ${cname}`)
      } catch (e) {
        log.warn(`dns: ${name}: ${(e as Error).message}`)
      }
    }
  }
  const existing = await client.getTunnelIngress(accountId, tunnelId)
  await client.putTunnelIngress(accountId, tunnelId, mergeAddRoutes(existing, domains))
}

export async function removeTunnelRoutes(
  client: CloudflareClient,
  accountId: string,
  tunnelId: string,
  domains: string[],
  log: { info: (m: string) => void; warn: (m: string) => void },
): Promise<void> {
  for (const d of domains) {
    const zoneId = await client.findZoneId(d).catch(() => null)
    if (!zoneId) continue
    for (const name of [d, `*.${d}`]) {
      const records = await client.listDNSRecords(zoneId, name).catch(() => [])
      for (const r of records) {
        if (!r.id) continue
        await client.deleteDNSRecord(zoneId, r.id).catch(() => undefined)
        log.info(`dns: removed ${name}`)
      }
    }
  }
  const existing = await client.getTunnelIngress(accountId, tunnelId)
  await client.putTunnelIngress(accountId, tunnelId, mergeRemoveRoutes(existing, domains))
}
