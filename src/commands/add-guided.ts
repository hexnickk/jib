import type { ParsedDomain } from '@jib/config'
import type { CliIssue } from '@jib/core'
import { type ComposeService, hasPublishedPorts, inferContainerPort } from '@jib/docker'

export interface AddServiceSummary {
  name: string
  inferredContainerPort?: number
  publishesPorts: boolean
}

export interface GuidedServiceAnswer {
  service: string
  expose?: boolean
  domainHosts?: string[]
  secretKeys?: string[]
}

export function splitCommaValues(raw: string): string[] {
  return raw
    .split(',')
    .map((value) => value.trim())
    .filter((value) => value.length > 0)
}

export function summarizeComposeServices(services: ComposeService[]): AddServiceSummary[] {
  return services.map((service) => ({
    name: service.name,
    inferredContainerPort: inferContainerPort(service),
    publishesPorts: hasPublishedPorts(service),
  }))
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
): { domains: ParsedDomain[]; secretKeys: string[] } {
  const knownServices = new Set(serviceNames)
  const domains: ParsedDomain[] = [...existingDomains]
  const secretKeys = new Set<string>()
  const servicesWithDomains = new Set(
    existingDomains.flatMap((domain) => (domain.service ? [domain.service] : [])),
  )

  for (const answer of answers) {
    if (!knownServices.has(answer.service)) continue
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

  return { domains, secretKeys: [...secretKeys] }
}

export function renderAddPlanSummary(input: {
  app: string
  composeFiles: string[]
  services: AddServiceSummary[]
  domains: ParsedDomain[]
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
