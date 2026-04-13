import { MissingInputError } from '@jib/cli'
import type { ParsedDomain } from '@jib/config'
import { tuiIsInteractive, tuiPromptSelectResult } from '@jib/tui'
import { addAssignCliDomainsToServices } from './guided.ts'

/** Collects per-domain service bindings, prompting only when needed. */
export async function addCollectDomains(
  domains: ParsedDomain[],
  serviceNames: string[],
): Promise<ParsedDomain[] | MissingInputError | Error> {
  if (serviceNames.length <= 1 || !tuiIsInteractive()) {
    const assigned = addAssignCliDomainsToServices(domains, serviceNames)
    if (assigned.issues.length > 0) {
      return new MissingInputError('missing required input for jib add', assigned.issues)
    }
    return assigned.domains
  }
  const out: ParsedDomain[] = []
  for (const domain of domains) {
    if (domain.service) {
      out.push(domain)
      continue
    }
    const service = await tuiPromptSelectResult({
      message: `Which service should handle ${domain.host}?`,
      options: serviceNames.map((name) => ({ value: name, label: name })),
    })
    if (service instanceof Error) return service
    out.push({
      ...domain,
      service,
    })
  }
  return out
}
