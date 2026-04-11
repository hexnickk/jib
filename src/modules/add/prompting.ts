import { MissingInputError } from '@jib/cli'
import type { ParsedDomain } from '@jib/config'
import type { ComposeService } from '@jib/docker'
import {
  isInteractive,
  promptConfirm,
  promptLines,
  promptSelect,
  promptString,
  promptStringOptional,
} from '@jib/tui'
import {
  assignCliDomainsToServices,
  buildAdditionalSecretPromptMessage,
  buildManualSecretPromptLines,
  buildSecretPromptMessage,
  parseEnvEntry,
  secretPromptPlaceholder,
  shouldDefaultExposeService,
  splitCommaValues,
  summarizeComposeServices,
  validateEnvEntry,
} from './guided.ts'

export async function collectDomains(
  domains: ParsedDomain[],
  serviceNames: string[],
): Promise<ParsedDomain[]> {
  if (serviceNames.length <= 1 || !isInteractive()) {
    const assigned = assignCliDomainsToServices(domains, serviceNames)
    if (assigned.issues.length > 0) {
      throw new MissingInputError('missing required input for jib add', assigned.issues)
    }
    return assigned.domains
  }
  return await Promise.all(
    domains.map(async (domain) =>
      domain.service
        ? domain
        : {
            ...domain,
            service: await promptSelect({
              message: `Which service should handle ${domain.host}?`,
              options: serviceNames.map((name) => ({ value: name, label: name })),
            }),
          },
    ),
  )
}

export async function promptForServices(
  domains: ParsedDomain[],
  composeServices: ComposeService[],
  secretValues: Map<string, string>,
) {
  const summaries = summarizeComposeServices(composeServices)
  return await Promise.all(
    summaries.map(async (service) => {
      const existingDomains = domains.filter((domain) => domain.service === service.name)
      const detectedKeys = service.envRefs ?? []
      const suggestedKeys = detectedKeys.filter((key) => !secretValues.has(key))
      const expose =
        existingDomains.length > 0 ||
        (isInteractive() &&
          (await promptConfirm({
            message: `Expose service "${service.name}" with a domain?`,
            initialValue: shouldDefaultExposeService(service, summaries.length),
          })))
      const domainHosts =
        isInteractive() && expose && existingDomains.length === 0
          ? splitCommaValues(
              await promptString({
                message: `Domain(s) for service "${service.name}" (comma-separated)`,
                placeholder: 'app.example.com',
              }),
            )
          : []
      const rawSecrets =
        isInteractive() && detectedKeys.length > 0
          ? await promptStringOptional({
              message:
                suggestedKeys.length > 0
                  ? buildSecretPromptMessage(service.name, suggestedKeys)
                  : buildAdditionalSecretPromptMessage(service.name, detectedKeys),
              placeholder: secretPromptPlaceholder(),
              ...(suggestedKeys.length > 0 ? { initialValue: suggestedKeys.join(',') } : {}),
            })
          : ''
      const secretKeys = splitCommaValues(rawSecrets).filter((key) => !secretValues.has(key))
      const envEntries =
        isInteractive() && suggestedKeys.length === 0 && detectedKeys.length === 0
          ? (
              await promptLines({
                title: `Secrets for "${service.name}"`,
                lines: buildManualSecretPromptLines(),
                promptLabel: 'secret',
                validateLine: validateEnvEntry,
              })
            )
              .map(parseEnvEntry)
              .filter((entry) => !secretValues.has(entry.key))
          : []
      return { service: service.name, expose, domainHosts, secretKeys, envEntries }
    }),
  )
}
