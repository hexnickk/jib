import { existsSync } from 'node:fs'
import { isAbsolute, join } from 'node:path'
import type { App, Domain } from '@jib/config'
import {
  type ComposeService,
  hasPublishedPorts,
  inferContainerPort,
  parseComposeServices,
} from './parse.ts'

const FALLBACK_CONTAINER_PORT = 80
const DEFAULT_COMPOSE_FILES = [
  'docker-compose.yml',
  'docker-compose.yaml',
  'compose.yml',
  'compose.yaml',
]

export type ComposeInspectionCode = 'compose_not_found' | 'compose_parse'

export class ComposeInspectionError extends Error {
  constructor(
    readonly code: ComposeInspectionCode,
    message: string,
    readonly details: { composeFiles?: string[]; availableFiles?: string[] } = {},
  ) {
    super(message)
    this.name = 'ComposeInspectionError'
  }
}

export interface ComposeInspection {
  composeFiles: string[]
  services: ComposeService[]
}

export function discoverComposeFiles(workdir: string): string[] {
  return DEFAULT_COMPOSE_FILES.filter((file) => existsSync(join(workdir, file)))
}

export function inspectComposeApp(
  appCfg: Pick<App, 'compose'>,
  workdir: string,
): ComposeInspection {
  const composeFiles = resolveComposeFiles(workdir, appCfg.compose ?? [])
  let services: ComposeService[]
  try {
    services = parseComposeServices(workdir, composeFiles)
  } catch (err) {
    throw new ComposeInspectionError(
      'compose_parse',
      `failed to parse compose file: ${err instanceof Error ? err.message : err}`,
      { composeFiles },
    )
  }
  if (services.length === 0) {
    throw new ComposeInspectionError(
      'compose_parse',
      `compose file ${composeFiles.join(', ')} has no services`,
      { composeFiles },
    )
  }
  return { composeFiles, services }
}

/**
 * Parse the compose file from the prepared workdir, resolve each ingress
 * mapping's `service` + `container_port`, and surface optional warnings
 * through the caller-provided `warn` callback. No disk writes.
 */
export function resolveFromCompose(
  appCfg: App,
  workdir: string,
  opts: { warn?: (message: string) => void } = {},
): App {
  const inspection = inspectComposeApp(appCfg, workdir)
  const parsed = inspection.services
  if (appCfg.domains.length === 0) return appCfg
  const byName = new Map(parsed.map((s) => [s.name, s]))
  const single = parsed.length === 1 ? parsed[0]?.name : undefined
  const publishing = new Map<string, ComposeService>()

  const nextDomains: Domain[] = appCfg.domains.map((d) => {
    const serviceName = d.service ?? single
    if (!serviceName) {
      throw new Error(
        `compose has multiple services (${parsed.map((s) => s.name).join(', ')}); specify =service in --domain for ${d.host}`,
      )
    }
    const svc = byName.get(serviceName)
    if (!svc) throw new Error(`--domain ${d.host}: compose has no service "${serviceName}"`)
    if (hasPublishedPorts(svc)) publishing.set(svc.name, svc)
    const containerPort = d.container_port ?? resolvePort(svc, opts.warn)
    return { ...d, service: svc.name, container_port: containerPort }
  })

  if (publishing.size > 0) warnPublished(publishing, nextDomains, opts.warn)
  return { ...appCfg, domains: nextDomains }
}

function resolveComposeFiles(workdir: string, composeFiles: string[]): string[] {
  if (composeFiles.length > 0) {
    const missing = composeFiles.filter(
      (file) => !existsSync(isAbsolute(file) ? file : join(workdir, file)),
    )
    if (missing.length > 0) {
      throw new ComposeInspectionError(
        'compose_not_found',
        `compose file not found: ${missing.join(', ')}`,
        { composeFiles: missing },
      )
    }
    return composeFiles
  }
  const discovered = discoverComposeFiles(workdir)
  if (discovered.length > 0) return [discovered[0] as string]
  throw new ComposeInspectionError('compose_not_found', 'no compose file found in the repo root', {
    availableFiles: discovered,
  })
}

function resolvePort(svc: ComposeService, warn?: (message: string) => void): number {
  const inferred = inferContainerPort(svc)
  if (inferred !== undefined) return inferred
  warn?.(
    `could not infer container port for service "${svc.name}"; defaulting to ${FALLBACK_CONTAINER_PORT}`,
  )
  return FALLBACK_CONTAINER_PORT
}

function warnPublished(
  publishing: Map<string, ComposeService>,
  domains: Domain[],
  warn?: (message: string) => void,
): void {
  if (!warn) return
  for (const [name, svc] of publishing) {
    const original = svc.ports.map((p) => JSON.stringify(p)).join(', ')
    const replacements = domains
      .filter((d) => d.service === name)
      .map((d) => `${d.port}:${d.container_port}`)
      .join(', ')
    warn(
      `service "${name}" publishes ports in compose (${original}); jib will replace with [${replacements}] via !override at deploy time.`,
    )
  }
  warn('consider removing `ports:` from your compose file to avoid confusion.')
}
