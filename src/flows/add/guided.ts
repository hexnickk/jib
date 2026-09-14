import type { CliIssue } from '@jib/cli'
import type { ParsedDomain } from '@jib/config'
import { type ComposeService, dockerHasPublishedPorts, dockerInferContainerPort } from '@jib/docker'
import { ValidationError } from '@jib/errors'
import { addUnionScopes } from './config-entries.ts'
import type { ConfigEntry, ConfigScope, EnvEntry } from './types.ts'

export interface AddServiceSummary {
  name: string
  inferredContainerPort?: number
  publishesPorts: boolean
}

/** Splits comma-separated user input into trimmed non-empty values. */
export function addSplitCommaValues(raw?: string | null): string[] {
  return (raw ?? '')
    .split(',')
    .map((value) => value.trim())
    .filter((value) => value.length > 0)
}

/** Parses a single `KEY=VALUE` entry for add-flow env configuration. */
export function addParseEnvEntry(raw: string): EnvEntry | ValidationError {
  const line = raw.trim()
  const eq = line.indexOf('=')
  if (eq < 1) {
    return new ValidationError(`invalid env entry "${raw}" - expected KEY=VALUE`)
  }
  return { key: line.slice(0, eq), value: line.slice(eq + 1) }
}

/** Validates one interactive env entry line and returns a human hint on failure. */
export function addValidateEnvEntry(raw: string): string | undefined {
  return raw.indexOf('=') < 1 ? 'expected KEY=VALUE (example: SECRET_KEY=VALUE)' : undefined
}

/** Summarizes compose services into the smaller add-flow service model. */
export function addSummarizeComposeServices(services: ComposeService[]): AddServiceSummary[] {
  return services.map((service) => {
    const inferredContainerPort = dockerInferContainerPort(service)
    return {
      name: service.name,
      ...(inferredContainerPort !== undefined ? { inferredContainerPort } : {}),
      publishesPorts: dockerHasPublishedPorts(service),
    }
  })
}

/** Assigns CLI domains to services or returns issues when multiple services exist. */
export function addAssignCliDomainsToServices(
  domains: ParsedDomain[],
  serviceNames: string[],
): { domains: ParsedDomain[]; issues: CliIssue[] } {
  if (domains.length === 0) {
    return { domains: [], issues: [] }
  }
  if (serviceNames.length <= 1) {
    const fallback = serviceNames[0]
    return {
      domains: domains.map((domain) =>
        domain.service || !fallback ? domain : { ...domain, service: fallback },
      ),
      issues: [],
    }
  }

  const issues: CliIssue[] = []
  const nextDomains = domains.map((domain, index) => {
    if (domain.service) {
      return domain
    }
    issues.push({
      field: `domain[${index}].service`,
      message: `compose has multiple services (${serviceNames.join(', ')}); rerun with --domain host=${domain.host},service=<${serviceNames.join('|')}>`,
    })
    return domain
  })
  return { domains: nextDomains, issues }
}

/** Deduplicates app variables and combines runtime/build usage across all services. */
export function addDetectedConfigScopes(services: ComposeService[]): Map<string, ConfigScope> {
  const out = new Map<string, ConfigScope>()
  for (const service of services) {
    for (const key of service.envRefs) {
      out.set(key, addUnionScopes(out.get(key) ?? 'runtime', 'runtime'))
    }
    for (const key of service.buildArgRefs) {
      out.set(key, addUnionScopes(out.get(key) ?? 'build', 'build'))
    }
  }
  return out
}

/** Renders the final add plan summary shown before config is written. */
export function addRenderPlanSummary(input: {
  app: string
  composeFiles: string[]
  services: AddServiceSummary[]
  domains: { host: string; service?: string | undefined }[]
  configEntries: ConfigEntry[]
  envFile: string
}): string {
  const lines = [`app "${input.app}"`, `compose: ${input.composeFiles.join(', ')}`]
  lines.push('services:')
  for (const service of input.services) {
    const hosts = input.domains
      .filter((domain) => domain.service === service.name)
      .map((domain) => domain.host)
    const exposure = hosts.length > 0 ? hosts.join(', ') : 'internal only'
    lines.push(`  ${service.name}: ${exposure}`)
  }
  for (const scope of ['runtime', 'build'] as const) {
    const variables = input.configEntries
      .filter((entry) => entry.scope === scope || entry.scope === 'both')
      .map((entry) => `  ${entry.key}`)
    lines.push(
      `${scope} vars (${input.envFile}):`,
      ...(variables.length > 0 ? variables : ['  none']),
    )
  }
  return lines.join('\n')
}
