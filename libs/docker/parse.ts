import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parse as parseYaml } from 'yaml'

export interface ComposeService {
  name: string
  /** First host-mapped port, 0 if none. */
  hostPort: number
  /** Raw `ports:` entries from the compose file (normalised to an array). */
  ports: unknown[]
  /** Raw `expose:` entries from the compose file. */
  expose: unknown[]
  /** `jib.domain` label, if set. */
  domain?: string
  /** `jib.ingress` label, if set. */
  ingress?: string
  /** Parsed from `healthcheck.test` when it's a curl/wget URL. */
  healthPath?: string
  healthPort?: number
}

interface RawService {
  ports?: unknown[]
  expose?: unknown[]
  labels?: Record<string, string> | string[]
  healthcheck?: { test?: unknown }
}

interface RawComposeFile {
  services?: Record<string, RawService>
}

/**
 * Parses one or more compose files from `repoDir` and merges services. Later
 * files override earlier ones field-by-field, matching the Go parser.
 */
export function parseComposeServices(
  repoDir: string,
  composeFiles: string[] = [],
): ComposeService[] {
  const files = composeFiles.length > 0 ? composeFiles : ['docker-compose.yml']
  const merged = new Map<string, RawService>()

  for (const f of files) {
    const data = readFileSync(join(repoDir, f), 'utf8')
    const cf = (parseYaml(data) ?? {}) as RawComposeFile
    for (const [name, svc] of Object.entries(cf.services ?? {})) {
      const existing = merged.get(name) ?? {}
      const next: RawService = { ...existing }
      if (svc.ports) next.ports = svc.ports
      if (svc.expose) next.expose = svc.expose
      if (svc.labels) next.labels = svc.labels
      if (svc.healthcheck) next.healthcheck = svc.healthcheck
      merged.set(name, next)
    }
  }

  const out: ComposeService[] = []
  for (const [name, svc] of merged) {
    const labels = normalizeLabels(svc.labels)
    const cs: ComposeService = {
      name,
      hostPort: svc.ports?.length ? parseFirstHostPort(svc.ports[0]) : 0,
      ports: svc.ports ?? [],
      expose: svc.expose ?? [],
    }
    if (labels['jib.domain']) cs.domain = labels['jib.domain']
    if (labels['jib.ingress']) cs.ingress = labels['jib.ingress']
    if (svc.healthcheck?.test) {
      const parsed = parseHealthcheck(svc.healthcheck.test)
      if (parsed) {
        cs.healthPath = parsed.path
        cs.healthPort = parsed.port
      }
    }
    out.push(cs)
  }
  return out
}

/** Compose labels can be `{k:v}` or `["k=v"]` — normalise to a record. */
function normalizeLabels(labels: RawService['labels']): Record<string, string> {
  if (!labels) return {}
  if (Array.isArray(labels)) {
    const out: Record<string, string> = {}
    for (const entry of labels) {
      const idx = entry.indexOf('=')
      if (idx > 0) out[entry.slice(0, idx)] = entry.slice(idx + 1)
    }
    return out
  }
  return labels
}

/** Handles `"3000:3000"`, `3000`, `{published: 3000, target: 80}`, etc. */
export function parseFirstHostPort(p: unknown): number {
  if (typeof p === 'number') return Math.floor(p)
  if (typeof p === 'string') {
    const stripped = p.split('/')[0] ?? p
    if (stripped.includes(':')) {
      const parts = stripped.split(':')
      const hostPart = parts.length === 3 ? parts[1] : parts[0]
      return Number.parseInt(hostPart ?? '', 10) || 0
    }
    return Number.parseInt(stripped, 10) || 0
  }
  if (p && typeof p === 'object' && 'published' in p) {
    const v = (p as { published: unknown }).published
    if (typeof v === 'number') return Math.floor(v)
    if (typeof v === 'string') return Number.parseInt(v, 10) || 0
  }
  return 0
}

/** Extract `{path, port}` from a healthcheck.test entry. */
export function parseHealthcheck(test: unknown): { path: string; port: number } | undefined {
  const cmdStr = Array.isArray(test)
    ? test.filter((x): x is string => typeof x === 'string').join(' ')
    : typeof test === 'string'
      ? test
      : ''
  const match = cmdStr.match(/https?:\/\/(?:localhost|127\.0\.0\.1):(\d+)(\/[^\s'"]*)?/)
  if (!match) return undefined
  const port = Number.parseInt(match[1] ?? '', 10)
  if (!port) return undefined
  return { path: match[2] && match[2].length > 0 ? match[2] : '/health', port }
}

/** Prefer a service with both healthcheck and host port; fall back to first host-mapped port. */
export function inferHealthAndPort(services: ComposeService[]): { path: string; port: number } {
  for (const s of services) {
    if (s.healthPath && s.hostPort > 0) return { path: s.healthPath, port: s.hostPort }
  }
  for (const s of services) {
    if (s.hostPort > 0) return { path: '/health', port: s.hostPort }
  }
  return { path: '/health', port: 0 }
}

export function inferPorts(services: ComposeService[]): number[] {
  return services.filter((s) => s.hostPort > 0).map((s) => s.hostPort)
}

export function servicesWithDomainLabels(services: ComposeService[]): ComposeService[] {
  return services.filter((s) => s.domain)
}

/**
 * Infer the port exposed *inside* the container for a service. Priority:
 *   1. first entry in `ports:` (container side of `host:container`)
 *   2. first entry in `expose:`
 *   3. undefined
 * Used by `jib add` to fill `domain.container_port` from the compose file
 * so the deployer can emit a correct `!override` ports list.
 */
export function inferContainerPort(service: ComposeService): number | undefined {
  if (service.ports.length > 0) {
    const p = parseContainerSide(service.ports[0])
    if (p) return p
  }
  if (service.expose.length > 0) {
    const e = service.expose[0]
    const n = typeof e === 'number' ? e : Number.parseInt(String(e), 10)
    if (Number.isFinite(n) && n > 0) return Math.floor(n)
  }
  return undefined
}

/** True when the user's compose file declares a non-empty `ports:` list. */
export function hasPublishedPorts(service: ComposeService): boolean {
  return service.ports.length > 0
}

/** Extract the *container* side of a single `ports:` entry. */
function parseContainerSide(p: unknown): number | undefined {
  if (typeof p === 'number') return Math.floor(p)
  if (typeof p === 'string') {
    const stripped = p.split('/')[0] ?? p
    const parts = stripped.split(':')
    // "80" → container 80; "8080:80" → 80; "127.0.0.1:8080:80" → 80
    const tail = parts[parts.length - 1] ?? ''
    const n = Number.parseInt(tail, 10)
    return Number.isFinite(n) && n > 0 ? n : undefined
  }
  if (p && typeof p === 'object' && 'target' in p) {
    const v = (p as { target: unknown }).target
    if (typeof v === 'number') return Math.floor(v)
    if (typeof v === 'string') {
      const n = Number.parseInt(v, 10)
      return Number.isFinite(n) && n > 0 ? n : undefined
    }
  }
  return undefined
}
