import { readFileSync } from 'node:fs'
import { isAbsolute, join } from 'node:path'
import { parse as parseYaml } from 'yaml'

interface RawService {
  volumes?: unknown[]
}

interface RawComposeFile {
  services?: Record<string, RawService>
}

export interface UnsafeBindMount {
  service: string
  source: string
}

/** Scans compose services for host bind mounts that would break jib app isolation. */
export function dockerFindUnsafeBindMounts(
  repoDir: string,
  composeFiles: string[] = [],
): UnsafeBindMount[] {
  const files = composeFiles.length > 0 ? composeFiles : ['docker-compose.yml']
  const merged = new Map<string, RawService>()

  for (const f of files) {
    const data = readFileSync(isAbsolute(f) ? f : join(repoDir, f), 'utf8')
    const cf = (parseYaml(data) ?? {}) as RawComposeFile
    for (const [name, svc] of Object.entries(cf.services ?? {})) {
      const existing = merged.get(name) ?? {}
      merged.set(name, { ...existing, ...(svc.volumes ? { volumes: svc.volumes } : {}) })
    }
  }

  const out: UnsafeBindMount[] = []
  for (const [service, svc] of merged) {
    for (const volume of svc.volumes ?? []) {
      const source = bindMountSource(volume)
      if (source) out.push({ service, source })
    }
  }
  return out
}

/** Pulls the host-side source path out of short-form and long-form bind mounts. */
function bindMountSource(volume: unknown): string | null {
  if (typeof volume === 'string') {
    const source = volume.split(':')[0] ?? ''
    if (!source || !sourceLooksLikeHostPath(source)) return null
    return source
  }
  if (!volume || typeof volume !== 'object') return null
  const raw = volume as { type?: unknown; source?: unknown }
  if (raw.type === 'bind' && typeof raw.source === 'string' && raw.source.length > 0) {
    return raw.source
  }
  if (typeof raw.source === 'string' && sourceLooksLikeHostPath(raw.source)) return raw.source
  return null
}

/** Approximates whether a compose volume source points at the host filesystem. */
function sourceLooksLikeHostPath(source: string): boolean {
  return (
    source.startsWith('/') ||
    source.startsWith('./') ||
    source.startsWith('../') ||
    source === '.' ||
    source === '..' ||
    source.startsWith('~/')
  )
}
