import { existsSync } from 'node:fs'
import { isAbsolute, join } from 'node:path'
import type { App, Domain } from '@jib/config'
import { ValidationError } from '@jib/errors'
import { loggingCreateLogger } from '@jib/logging'
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

export interface ComposeInspection {
  composeFiles: string[]
  services: ComposeService[]
}

/** Returns the default compose filenames that already exist under `workdir`. */
export function dockerDiscoverComposeFiles(workdir: string): string[] {
  return DEFAULT_COMPOSE_FILES.filter((file) => existsSync(join(workdir, file)))
}

/** Resolves the compose files for one app and parses their merged service list. */
export function dockerInspectComposeApp(
  workdir: string,
  declaredFiles: string[] = [],
): ComposeInspection | ValidationError {
  const composeFiles = resolveComposeFiles(workdir, declaredFiles)
  if (composeFiles instanceof Error) {
    return composeFiles
  }

  let services: ComposeService[]
  try {
    services = dockerParseComposeServices(workdir, composeFiles)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return new ValidationError(`failed to parse compose file: ${message}`, { cause: error })
  }
  if (services.length === 0) {
    return new ValidationError(`compose file ${composeFiles.join(', ')} has no services`)
  }
  return { composeFiles, services }
}

/** Resolves ingress service bindings and container ports from parsed compose files. */
export function dockerResolveFromCompose(appCfg: App, workdir: string): App | ValidationError {
  const inspection = dockerInspectComposeApp(workdir, appCfg.compose)
  if (inspection instanceof Error) {
    return inspection
  }
  const parsed = inspection.services
  if (appCfg.domains.length === 0) {
    return appCfg
  }
  const byName = new Map(parsed.map((service) => [service.name, service]))
  const single = parsed.length === 1 ? parsed[0]?.name : undefined
  const publishing = new Map<string, ComposeService>()

  const nextDomains: Domain[] = []
  for (const domain of appCfg.domains) {
    const serviceName = domain.service ?? single
    if (!serviceName) {
      return new ValidationError(
        `compose has multiple services (${parsed.map((service) => service.name).join(', ')}); specify =service in --domain for ${domain.host}`,
      )
    }
    const service = byName.get(serviceName)
    if (!service) {
      return new ValidationError(`--domain ${domain.host}: compose has no service "${serviceName}"`)
    }
    if (dockerHasPublishedPorts(service)) {
      publishing.set(service.name, service)
    }
    let containerPort = domain.container_port ?? dockerInferContainerPort(service)
    if (containerPort === undefined) {
      loggingCreateLogger('docker').warn(
        `could not infer container port for service "${service.name}"; defaulting to ${FALLBACK_CONTAINER_PORT}`,
      )
      containerPort = FALLBACK_CONTAINER_PORT
    }
    nextDomains.push({ ...domain, service: service.name, container_port: containerPort })
  }

  if (publishing.size > 0) {
    warnPublished(publishing, nextDomains)
  }
  return { ...appCfg, domains: nextDomains }
}

/** Resolves explicit compose paths or falls back to the first default compose file on disk. */
function resolveComposeFiles(workdir: string, composeFiles: string[]): ValidationError | string[] {
  if (composeFiles.length > 0) {
    const missing = composeFiles.filter(
      (file) => !existsSync(isAbsolute(file) ? file : join(workdir, file)),
    )
    if (missing.length > 0) {
      return new ValidationError(`compose file not found: ${missing.join(', ')}`)
    }
    return composeFiles
  }
  const discovered = dockerDiscoverComposeFiles(workdir)
  if (discovered.length > 0) {
    return [discovered[0] as string]
  }
  return new ValidationError('no compose file found in the repo root')
}

/** Explains when jib will replace user-declared `ports:` entries with managed ingress mappings. */
function warnPublished(publishing: Map<string, ComposeService>, domains: Domain[]): void {
  const log = loggingCreateLogger('docker')
  for (const [name, service] of publishing) {
    const original = service.ports.map((port) => JSON.stringify(port)).join(', ')
    const replacements = domains
      .filter((domain) => domain.service === name)
      .map((domain) => `${domain.port}:${domain.container_port}`)
      .join(', ')
    log.warn(
      `service "${name}" publishes ports in compose (${original}); jib will replace with [${replacements}] via !override at deploy time.`,
    )
  }
  log.warn('consider removing `ports:` from your compose file to avoid confusion.')
}
