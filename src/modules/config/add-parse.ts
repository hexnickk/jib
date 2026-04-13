import { ParseDomainArgError, ParseHealthArgError, PortExhaustedError } from './errors.ts'
import { configAllocatePort } from './port-allocator.ts'
import type { App, Config, Domain } from './schema.ts'

export interface ParsedDomain {
  host: string
  container_port?: number
  service?: string
  ingress?: '' | 'direct' | 'cloudflare-tunnel'
}

const VALID_INGRESS = new Set(['direct', 'cloudflare-tunnel'])

/** Parse `host=<domain>[,port=<n>][,service=<name>][,ingress=direct|cloudflare-tunnel]`. */
export function configParseDomain(
  raw: string,
  fallback: string,
): ParsedDomain | ParseDomainArgError {
  const pairs = new Map<string, string>()
  for (const part of raw.split(',')) {
    const eq = part.indexOf('=')
    if (eq < 1) {
      return new ParseDomainArgError(`invalid --domain "${raw}" (expected key=value pairs)`)
    }
    pairs.set(part.slice(0, eq), part.slice(eq + 1))
  }

  const host = pairs.get('host')
  if (!host) {
    return new ParseDomainArgError(`invalid --domain "${raw}" (missing required "host" key)`)
  }

  const out: ParsedDomain = { host }
  const portStr = pairs.get('port')
  if (portStr !== undefined) {
    const container_port = Number(portStr)
    if (!Number.isInteger(container_port) || container_port < 1 || container_port > 65535) {
      return new ParseDomainArgError(`invalid port in --domain "${raw}" (expected integer 1-65535)`)
    }
    out.container_port = container_port
  }

  const service = pairs.get('service')
  if (service) out.service = service

  const ingress = pairs.get('ingress') ?? fallback
  if (ingress && !VALID_INGRESS.has(ingress)) {
    return new ParseDomainArgError(
      `invalid ingress "${ingress}" in --domain "${raw}" (expected direct|cloudflare-tunnel)`,
    )
  }
  if (ingress && ingress !== 'direct') {
    out.ingress = ingress as Exclude<ParsedDomain['ingress'], undefined>
  }
  return out
}

/** Parse `/path:port` into a health check entry. */
export function configParseHealth(
  raw: string,
): { path: string; port: number } | ParseHealthArgError {
  const idx = raw.lastIndexOf(':')
  if (idx < 1) return new ParseHealthArgError(`invalid --health "${raw}" (expected /path:port)`)

  const path = raw.slice(0, idx)
  const port = Number(raw.slice(idx + 1))
  if (!path.startsWith('/')) return new ParseHealthArgError(`--health path must start with '/'`)
  if (!Number.isInteger(port)) {
    return new ParseHealthArgError(`invalid port in --health "${raw}"`)
  }
  return { path, port }
}

export function configToArray(value: string | string[] | undefined): string[] {
  if (value === undefined) return []
  return Array.isArray(value) ? value : [value]
}

/**
 * Assigns a host port to every ingress mapping that lacks one. Each
 * allocation re-reads the partially-filled config so two fresh domains in
 * the same `add` never collide.
 */
export async function configAssignPorts(
  cfg: Config,
  app: string,
  domains: Domain[],
): Promise<Domain[] | PortExhaustedError> {
  if (domains.length === 0) return []
  const out: Domain[] = []
  const base = (cfg.apps[app] ?? { domains: [] as Domain[] }) as App
  const scratch: Config = {
    ...cfg,
    apps: { ...cfg.apps, [app]: { ...base, domains: [] as Domain[] } },
  }
  for (const domain of domains) {
    if (domain.port !== undefined) {
      out.push(domain)
    } else {
      const allocated = await configAllocatePort({ config: scratch, probeHost: true })
      if (allocated instanceof PortExhaustedError) return allocated
      out.push({ ...domain, port: allocated })
    }
    const current = scratch.apps[app] as App
    scratch.apps[app] = { ...current, domains: [...out] }
  }
  return out
}
