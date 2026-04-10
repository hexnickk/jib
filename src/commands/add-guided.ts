import type { ParsedDomain } from '@jib/config'
import { type CliIssue, ValidationError } from '@jib/core'
import { type ComposeService, hasPublishedPorts, inferContainerPort } from '@jib/docker'
import type { EnvEntry } from '@jib/flows'

export interface AddServiceSummary {
  name: string
  inferredContainerPort?: number
  publishesPorts: boolean
  envRefs?: string[]
}

export interface GuidedServiceAnswer {
  service: string
  expose?: boolean
  domainHosts?: string[]
  secretKeys?: string[]
  envEntries?: EnvEntry[]
}

export function splitCommaValues(raw?: string | null): string[] {
  return (raw ?? '')
    .split(',')
    .map((value) => value.trim())
    .filter((value) => value.length > 0)
}

export function buildSecretPromptMessage(serviceName: string, suggestedKeys: string[]): string {
  return `Secret keys for "${serviceName}" (detected in docker-compose; edit if needed, comma-separated; values prompted next): ${suggestedKeys.join(', ')}`
}

export function buildAdditionalSecretPromptMessage(
  serviceName: string,
  detectedKeys: string[],
): string {
  return `Additional secret keys for "${serviceName}"? (docker-compose already detected: ${detectedKeys.join(', ')}; comma-separated, blank to skip)`
}

export function secretPromptPlaceholder(): string {
  return 'DATABASE_URL, API_KEY'
}

export function buildManualSecretPromptLines(): string[] {
  return [
    'Jib could not detect any required secrets from docker-compose.',
    'Enter secrets as KEY=VALUE, one per line.',
    'Examples:',
    'SECRET_KEY=VALUE',
    'API_KEY=VALUE',
    'Press Enter on a blank line when finished.',
  ]
}

export function validateEnvEntry(raw: string): string | undefined {
  return raw.indexOf('=') < 1 ? 'expected KEY=VALUE (example: SECRET_KEY=VALUE)' : undefined
}

export function parseEnvEntry(raw: string): EnvEntry {
  const line = raw.trim()
  const eq = line.indexOf('=')
  if (eq < 1) throw new ValidationError(`invalid env entry "${raw}" - expected KEY=VALUE`)
  return { key: line.slice(0, eq), value: line.slice(eq + 1) }
}

export function summarizeComposeServices(services: ComposeService[]): AddServiceSummary[] {
  return services.map((service) => {
    const inferredContainerPort = inferContainerPort(service)
    return {
      name: service.name,
      ...(inferredContainerPort !== undefined ? { inferredContainerPort } : {}),
      publishesPorts: hasPublishedPorts(service),
      ...(service.envRefs.length > 0 ? { envRefs: service.envRefs } : {}),
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

export function mergeGuidedServiceAnswers(
  existingDomains: ParsedDomain[],
  serviceNames: string[],
  answers: GuidedServiceAnswer[],
  ingressDefault: string,
): { domains: ParsedDomain[]; envEntries: EnvEntry[]; secretKeys: string[] } {
  const knownServices = new Set(serviceNames)
  const domains: ParsedDomain[] = [...existingDomains]
  const envEntries: EnvEntry[] = []
  const secretKeys = new Set<string>()
  const servicesWithDomains = new Set(
    existingDomains.flatMap((domain) => (domain.service ? [domain.service] : [])),
  )

  for (const answer of answers) {
    if (!knownServices.has(answer.service)) continue
    for (const entry of answer.envEntries ?? []) {
      envEntries.push(entry)
      secretKeys.add(entry.key)
    }
    for (const key of answer.secretKeys ?? []) {
      secretKeys.add(key)
    }
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

  return { domains, envEntries, secretKeys: [...secretKeys] }
}

export function renderAddPlanSummary(input: {
  app: string
  composeFiles: string[]
  services: AddServiceSummary[]
  domains: { host: string; service?: string | undefined }[]
  secretKeys: string[]
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
  lines.push(`secrets file: ${input.envFile}`)
  lines.push(`secret keys: ${input.secretKeys.length > 0 ? input.secretKeys.join(', ') : 'none'}`)
  return lines.join('\n')
}

export function shouldDefaultExposeService(
  service: AddServiceSummary,
  totalServices: number,
): boolean {
  if (totalServices !== 1) return false
  return service.inferredContainerPort !== undefined || service.publishesPorts
}
