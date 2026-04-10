import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parse as parseYaml } from 'yaml'

/**
 * Minimal projection of a compose service used by `jib add` to resolve
 * `domain.service` + `domain.container_port`. Healthchecks, jib.* labels,
 * and host ports are intentionally not surfaced here — `jib add` only asks
 * "what services exist, what does each one publish, what can it expose?".
 */
export interface ComposeService {
  name: string
  /** Raw `ports:` entries from the compose file (normalised to an array). */
  ports: unknown[]
  /** Raw `expose:` entries from the compose file. */
  expose: unknown[]
  /** Environment keys the compose file expects the operator to supply. */
  envRefs: string[]
}

interface RawService {
  ports?: unknown[]
  expose?: unknown[]
  environment?: unknown
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
      if (svc.environment !== undefined) next.environment = svc.environment
      merged.set(name, next)
    }
  }

  const out: ComposeService[] = []
  for (const [name, svc] of merged) {
    out.push({
      name,
      ports: svc.ports ?? [],
      expose: svc.expose ?? [],
      envRefs: parseEnvRefs(svc.environment),
    })
  }
  return out
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

function parseEnvRefs(environment: unknown): string[] {
  const refs = new Set<string>()
  if (Array.isArray(environment)) {
    for (const entry of environment) {
      if (typeof entry !== 'string') continue
      const eq = entry.indexOf('=')
      if (eq < 0) {
        if (entry) refs.add(entry)
        continue
      }
      const key = entry.slice(0, eq)
      const value = entry.slice(eq + 1)
      if (key && (value.length === 0 || value.includes('${'))) refs.add(key)
    }
    return [...refs]
  }
  if (!environment || typeof environment !== 'object') return []
  for (const [key, value] of Object.entries(environment as Record<string, unknown>)) {
    if (value === null || value === undefined) {
      refs.add(key)
      continue
    }
    if (typeof value === 'string' && value.includes('${')) refs.add(key)
  }
  return [...refs]
}
