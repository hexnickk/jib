import { existsSync } from 'node:fs'
import { isAbsolute, join } from 'node:path'
import type { App, Domain } from '@jib/config'
import { JibError } from '@jib/errors'
import { DockerDomainServiceNotFoundError, DockerDomainServiceRequiredError } from './errors.ts'
import {
  type ComposeService,
  dockerHasPublishedPorts,
  dockerInferContainerPort,
  dockerParseComposeServices,
} from './parse.ts'

const FALLBACK_CONTAINER_PORT = 80
const DEFAULT_COMPOSE_FILES = [
  'docker-compose.yml',
  'docker-compose.yaml',
  'compose.yml',
  'compose.yaml',
]

export type ComposeInspectionCode = 'compose_not_found' | 'compose_parse'

export class ComposeInspectionError extends JibError {
  constructor(
    override readonly code: ComposeInspectionCode,
    message: string,
    readonly details: { composeFiles?: string[]; availableFiles?: string[] } = {},
  ) {
    super(code, message)
    this.name = 'ComposeInspectionError'
  }
}

export interface ComposeInspection {
  composeFiles: string[]
  services: ComposeService[]
}

export type ResolveFromComposeError =
  | ComposeInspectionError
  | DockerDomainServiceRequiredError
  | DockerDomainServiceNotFoundError

/** Returns the default compose filenames that already exist under `workdir`. */
export function dockerDiscoverComposeFiles(workdir: string): string[] {
  return DEFAULT_COMPOSE_FILES.filter((file) => existsSync(join(workdir, file)))
}

/**
 * Resolves the compose files for one app and parses their merged service list.
 * Returns a typed inspection error instead of throwing for expected problems.
 */
export function dockerInspectComposeApp(
  appCfg: Pick<App, 'compose'>,
  workdir: string,
): ComposeInspection | ComposeInspectionError {
  const composeFiles = resolveComposeFiles(workdir, appCfg.compose ?? [])
  if (composeFiles instanceof ComposeInspectionError) return composeFiles
  let services: ComposeService[]
  try {
    services = dockerParseComposeServices(workdir, composeFiles)
  } catch (err) {
    return new ComposeInspectionError(
      'compose_parse',
      `failed to parse compose file: ${err instanceof Error ? err.message : err}`,
      { composeFiles },
    )
  }
  if (services.length === 0) {
    return new ComposeInspectionError(
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
export function dockerResolveFromCompose(
  appCfg: App,
  workdir: string,
  opts: { warn?: (message: string) => void } = {},
): App | ResolveFromComposeError {
  const inspection = dockerInspectComposeApp(appCfg, workdir)
  if (inspection instanceof ComposeInspectionError) return inspection
  const parsed = inspection.services
  if (appCfg.domains.length === 0) return appCfg
  const byName = new Map(parsed.map((s) => [s.name, s]))
  const single = parsed.length === 1 ? parsed[0]?.name : undefined
  const publishing = new Map<string, ComposeService>()

  const nextDomains: Domain[] = []
  for (const d of appCfg.domains) {
    const serviceName = d.service ?? single
    if (!serviceName) {
      return new DockerDomainServiceRequiredError(
        d.host,
        parsed.map((service) => service.name),
      )
    }
    const svc = byName.get(serviceName)
    if (!svc) return new DockerDomainServiceNotFoundError(d.host, serviceName)
    if (dockerHasPublishedPorts(svc)) publishing.set(svc.name, svc)
    const containerPort = d.container_port ?? resolvePort(svc, opts.warn)
    nextDomains.push({ ...d, service: svc.name, container_port: containerPort })
  }

  if (publishing.size > 0) warnPublished(publishing, nextDomains, opts.warn)
  return { ...appCfg, domains: nextDomains }
}

/** Resolves explicit compose paths or falls back to the first default compose file on disk. */
function resolveComposeFiles(
  workdir: string,
  composeFiles: string[],
): ComposeInspectionError | string[] {
  if (composeFiles.length > 0) {
    const missing = composeFiles.filter(
      (file) => !existsSync(isAbsolute(file) ? file : join(workdir, file)),
    )
    if (missing.length > 0) {
      return new ComposeInspectionError(
        'compose_not_found',
        `compose file not found: ${missing.join(', ')}`,
        { composeFiles: missing },
      )
    }
    return composeFiles
  }
  const discovered = dockerDiscoverComposeFiles(workdir)
  if (discovered.length > 0) return [discovered[0] as string]
  return new ComposeInspectionError('compose_not_found', 'no compose file found in the repo root', {
    availableFiles: discovered,
  })
}

/** Picks the inferred container port for one service, defaulting to `80` when compose is silent. */
function resolvePort(svc: ComposeService, warn?: (message: string) => void): number {
  const inferred = dockerInferContainerPort(svc)
  if (inferred !== undefined) return inferred
  warn?.(
    `could not infer container port for service "${svc.name}"; defaulting to ${FALLBACK_CONTAINER_PORT}`,
  )
  return FALLBACK_CONTAINER_PORT
}

/** Explains when jib will replace user-declared `ports:` entries with managed ingress mappings. */
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
