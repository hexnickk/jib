import type { ParsedDomain } from '@jib/config'
import type { ComposeService } from '@jib/docker'
import type { JibError } from '@jib/errors'
import { tuiIsInteractive, tuiPromptConfirmResult, tuiPromptStringResult } from '@jib/tui'
import { addSplitCommaValues } from './guided.ts'

/** Finishes exposure and domain prompts for all services before app configuration. */
export async function addPromptForServices(
  domains: ParsedDomain[],
  composeServices: ComposeService[],
  ingressDefault: string,
): Promise<ParsedDomain[] | JibError> {
  const nextDomains = [...domains]
  if (!tuiIsInteractive()) {
    return nextDomains
  }
  for (const service of composeServices) {
    if (domains.some((domain) => domain.service === service.name)) {
      continue
    }
    const expose = await tuiPromptConfirmResult({
      message: `Expose service "${service.name}" with a domain?`,
      initialValue: composeServices.length === 1,
    })
    if (expose instanceof Error) {
      return expose
    }
    if (!expose) {
      continue
    }
    const hosts = await tuiPromptStringResult({
      message: `Domain(s) for service "${service.name}" (comma-separated)`,
      placeholder: 'app.example.com',
    })
    if (hosts instanceof Error) {
      return hosts
    }
    if (nextDomains.some((domain) => domain.service === service.name)) {
      continue
    }
    for (const host of addSplitCommaValues(hosts)) {
      nextDomains.push({
        host,
        service: service.name,
        ...(ingressDefault !== 'direct' ? { ingress: 'cloudflare-tunnel' as const } : {}),
      })
    }
  }
  return nextDomains
}
