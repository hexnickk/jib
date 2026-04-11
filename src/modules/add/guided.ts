import type { CliIssue } from '@jib/cli'
import type { ParsedDomain } from '@jib/config'
import { type ComposeService, hasPublishedPorts, inferContainerPort } from '@jib/docker'
import { ValidationError } from '@jib/errors'
import { inferScope, mergeConfigEntries } from './config-entries.ts'
import type { ConfigEntry, ConfigScope, EnvEntry } from './types.ts'

export interface AddServiceSummary {
  name: string
  inferredContainerPort?: number
  publishesPorts: boolean
  envRefs?: string[]
  buildArgRefs?: string[]
}

export interface GuidedServiceAnswer {
  service: string
  expose?: boolean
  domainHosts?: string[]
  configEntries?: ConfigEntry[]
}

export function splitCommaValues(raw?: string | null): string[] {
  return (raw ?? '')
    .split(',')
    .map((value) => value.trim())
    .filter((value) => value.length > 0)
}

export function parseEnvEntry(raw: string): EnvEntry {
  const line = raw.trim()
  const eq = line.indexOf('=')
  if (eq < 1) throw new ValidationError(`invalid env entry "${raw}" - expected KEY=VALUE`)
  return { key: line.slice(0, eq), value: line.slice(eq + 1) }
}

export function validateEnvEntry(raw: string): string | undefined {
  return raw.indexOf('=') < 1 ? 'expected KEY=VALUE (example: SECRET_KEY=VALUE)' : undefined
}

export function summarizeComposeServices(services: ComposeService[]): AddServiceSummary[] {
  return services.map((service) => {
    const inferredContainerPort = inferContainerPort(service)
    return {
      name: service.name,
      ...(inferredContainerPort !== undefined ? { inferredContainerPort } : {}),
      publishesPorts: hasPublishedPorts(service),
      ...(service.envRefs.length > 0 ? { envRefs: service.envRefs } : {}),
      ...(service.buildArgRefs.length > 0 ? { buildArgRefs: service.buildArgRefs } : {}),
    }
  })
}

export function assignCliDomainsToServices(
  domains: ParsedDomain[],
  serviceNames: string[],
): { domains: ParsedDomain[]; issues: CliIssue[] } {
  if (domains.length === 0) return { domains: [], issues: [] }
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
    if (domain.service) return domain
    issues.push({
      field: `domain[${index}].service`,
      message: `compose has multiple services (${serviceNames.join(', ')}); rerun with --domain host=${domain.host},service=<${serviceNames.join('|')}>`,
    })
    return domain
  })
  return { domains: nextDomains, issues }
}

export function requiredConfigScopes(service: AddServiceSummary): Map<string, ConfigScope> {
  const out = new Map<string, ConfigScope>()
  for (const key of service.envRefs ?? []) out.set(key, inferScope(true, out.has(key)))
  for (const key of service.buildArgRefs ?? []) {
    const prior = out.get(key)
    out.set(key, inferScope(prior === 'runtime' || prior === 'both', true))
  }
  return out
}

export function mergeGuidedServiceAnswers(
  existingDomains: ParsedDomain[],
  serviceNames: string[],
  answers: GuidedServiceAnswer[],
  ingressDefault: string,
): { domains: ParsedDomain[]; configEntries: ConfigEntry[] } {
  const knownServices = new Set(serviceNames)
  const domains: ParsedDomain[] = [...existingDomains]
  const configEntries: ConfigEntry[] = []
  const servicesWithDomains = new Set(
    existingDomains.flatMap((domain) => (domain.service ? [domain.service] : [])),
  )

  for (const answer of answers) {
    if (!knownServices.has(answer.service)) continue
    configEntries.push(...(answer.configEntries ?? []))
    if (!answer.expose || servicesWithDomains.has(answer.service)) continue
    for (const host of answer.domainHosts ?? []) {
      domains.push({
        host,
        service: answer.service,
        ...(ingressDefault !== 'direct' ? { ingress: 'cloudflare-tunnel' as const } : {}),
      })
    }
    if ((answer.domainHosts?.length ?? 0) > 0) {
      servicesWithDomains.add(answer.service)
    }
  }

  return { domains, configEntries: mergeConfigEntries(configEntries) }
}

export function renderAddPlanSummary(input: {
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
  const runtimeKeys = input.configEntries
    .filter((entry) => entry.scope === 'runtime' || entry.scope === 'both')
    .map((entry) => entry.key)
  const buildKeys = input.configEntries
    .filter((entry) => entry.scope === 'build' || entry.scope === 'both')
    .map((entry) => entry.key)
  lines.push(
    `runtime vars (${input.envFile}): ${runtimeKeys.length > 0 ? runtimeKeys.join(', ') : 'none'}`,
  )
  lines.push(`build args: ${buildKeys.length > 0 ? buildKeys.join(', ') : 'none'}`)
  return lines.join('\n')
}

export function shouldDefaultExposeService(
  _service: AddServiceSummary,
  totalServices: number,
): boolean {
  return totalServices === 1
}
