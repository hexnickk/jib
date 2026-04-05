import type { App, Config, Domain } from '@jib/config'
import { allocatePort } from '@jib/core'

export interface ParsedDomain {
  host: string
  container_port?: number
  service?: string
  ingress?: '' | 'direct' | 'cloudflare-tunnel'
}

/** Parse `host[:containerPort][@ingress][=service]` into a `ParsedDomain`. */
export function parseDomain(raw: string, fallback: string): ParsedDomain {
  let rest = raw
  let service: string | undefined
  const eq = rest.lastIndexOf('=')
  if (eq > 0) {
    service = rest.slice(eq + 1)
    rest = rest.slice(0, eq)
  }
  let ingress = fallback
  const at = rest.lastIndexOf('@')
  if (at > 0) {
    ingress = rest.slice(at + 1)
    rest = rest.slice(0, at)
  }
  const [host, portStr] = rest.split(':')
  if (!host)
    throw new Error(`invalid --domain "${raw}" (expected host[:containerPort][@ingress][=service])`)
  const out: ParsedDomain = { host }
  if (portStr !== undefined && portStr !== '') {
    const container_port = Number(portStr)
    if (!Number.isInteger(container_port) || container_port < 1 || container_port > 65535) {
      throw new Error(`invalid containerPort in --domain "${raw}"`)
    }
    out.container_port = container_port
  }
  if (service) out.service = service
  if (ingress && ingress !== 'direct') {
    out.ingress = ingress as Exclude<ParsedDomain['ingress'], undefined>
  }
  return out
}

/** Parse `/path:port` into a health check entry. */
export function parseHealth(raw: string): { path: string; port: number } {
  const idx = raw.lastIndexOf(':')
  if (idx < 1) throw new Error(`invalid --health "${raw}" (expected /path:port)`)
  const path = raw.slice(0, idx)
  const port = Number(raw.slice(idx + 1))
  if (!path.startsWith('/')) throw new Error(`--health path must start with '/'`)
  if (!Number.isInteger(port)) throw new Error(`invalid port in --health "${raw}"`)
  return { path, port }
}

export function toArray(value: string | string[] | undefined): string[] {
  if (value === undefined) return []
  return Array.isArray(value) ? value : [value]
}

/**
 * Assigns a host port to every domain that lacks one. Each allocation
 * re-reads the partially-filled config so two fresh domains in the same
 * `add` never collide.
 */
export async function assignPorts(cfg: Config, app: string, domains: Domain[]): Promise<Domain[]> {
  const out: Domain[] = []
  const base = (cfg.apps[app] ?? { domains: [] as Domain[] }) as App
  const scratch: Config = {
    ...cfg,
    apps: { ...cfg.apps, [app]: { ...base, domains: [] as Domain[] } },
  }
  for (const d of domains) {
    const assigned =
      d.port !== undefined
        ? d
        : { ...d, port: await allocatePort({ config: scratch, probeHost: true }) }
    out.push(assigned)
    const cur = scratch.apps[app] as App
    scratch.apps[app] = { ...cur, domains: [...out] }
  }
  return out
}
