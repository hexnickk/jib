import { MissingInputError } from '@jib/cli'
import type { ParsedDomain } from '@jib/config'
import { isInteractive, promptSelect } from '@jib/tui'
import { addAssignCliDomainsToServices } from './guided.ts'

/** Collects per-domain service bindings, prompting only when needed. */
export async function addCollectDomains(
  domains: ParsedDomain[],
  serviceNames: string[],
): Promise<ParsedDomain[]> {
  if (serviceNames.length <= 1 || !isInteractive()) {
    const assigned = addAssignCliDomainsToServices(domains, serviceNames)
    if (assigned.issues.length > 0) {
      throw new MissingInputError('missing required input for jib add', assigned.issues)
    }
    return assigned.domains
  }
  const out: ParsedDomain[] = []
  for (const domain of domains) {
    out.push(
      domain.service
        ? domain
        : {
            ...domain,
            service: await promptSelect({
              message: `Which service should handle ${domain.host}?`,
              options: serviceNames.map((name) => ({ value: name, label: name })),
            }),
          },
    )
  }
  return out
}
