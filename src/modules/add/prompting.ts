import { MissingInputError } from '@jib/cli'
import type { ParsedDomain } from '@jib/config'
import type { ComposeService } from '@jib/docker'
import {
  isInteractive,
  note,
  promptConfirm,
  promptLines,
  promptSelect,
  promptString,
} from '@jib/tui'
import { mergeConfigEntries, scopeCovers, scopeLabel } from './config-entries.ts'
import {
  assignCliDomainsToServices,
  parseEnvEntry,
  requiredConfigScopes,
  shouldDefaultExposeService,
  splitCommaValues,
  summarizeComposeServices,
  validateEnvEntry,
} from './guided.ts'
import type { ConfigEntry, ConfigScope } from './types.ts'

const MANUAL_CONFIG_LINES = [
  'Enter additional environment variables as KEY=VALUE, one per line.',
  'New entries are added to the runtime .env file by default.',
  'If you need extra build args, add them to the app config after add completes.',
  'Press Enter on a blank line when finished.',
]

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

export async function promptForServices(
  domains: ParsedDomain[],
  composeServices: ComposeService[],
  initialEntries: ConfigEntry[],
) {
  const summaries = summarizeComposeServices(composeServices)
  const provided = new Map(initialEntries.map((entry) => [entry.key, entry]))
  const issues: { field: string; message: string }[] = []
  const answers = []

  for (const service of summaries) {
    const existingDomains = domains.filter((domain) => domain.service === service.name)
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

    const requiredEntries = [...requiredConfigScopes(service)].filter(([key, requiredScope]) => {
      const existing = provided.get(key)
      return !(existing && scopeCovers(existing.scope, requiredScope))
    })

    const configEntries: ConfigEntry[] = []
    if (!isInteractive()) {
      for (const [key, requiredScope] of requiredEntries) {
        issues.push({
          field: `env.${key}`,
          message: `${service.name} requires ${key} for ${scopeLabel(requiredScope)}; rerun with --env ${key}=VALUE, --build-arg ${key}=VALUE, or --build-env ${key}=VALUE`,
        })
      }
    } else if (requiredEntries.length > 0) {
      const useRecommended = await confirmRecommendedScopes(service.name, requiredEntries)
      for (const [key, requiredScope] of requiredEntries) {
        const existing = provided.get(key)
        const scope = useRecommended
          ? requiredScope
          : await promptRequiredScope(service.name, key, requiredScope)
        const entry = {
          key,
          value:
            existing?.value ??
            (await promptString({
              message: `Value for ${key}`,
              placeholder: scope === 'build' ? 'https://example.com' : 'secret-or-value',
            })),
          scope,
        } satisfies ConfigEntry
        configEntries.push(entry)
        provided.set(key, mergeEntry(existing, entry))
      }
    }

    if (
      isInteractive() &&
      (await promptConfirm({
        message: `Add more runtime environment variables for "${service.name}"?`,
        initialValue: false,
      }))
    ) {
      const manual = await promptLines({
        title: `Additional runtime environment variables for "${service.name}"`,
        lines: MANUAL_CONFIG_LINES,
        promptLabel: 'var',
        validateLine: validateEnvEntry,
      })
      for (const raw of manual) {
        const base = parseEnvEntry(raw)
        const existing = provided.get(base.key)
        const entry = { ...base, scope: existing?.scope ?? 'runtime' }
        configEntries.push(entry)
        provided.set(base.key, mergeEntry(existing, entry))
      }
    }

    answers.push({ service: service.name, expose, domainHosts, configEntries })
  }

  if (issues.length > 0) {
    throw new MissingInputError('missing required input for jib add', issues)
  }
  return answers
}

function mergeEntry(existing: ConfigEntry | undefined, next: ConfigEntry): ConfigEntry {
  return mergeConfigEntries(existing ? [existing, next] : [next])[0] as ConfigEntry
}

async function confirmRecommendedScopes(
  service: string,
  entries: [string, ConfigScope][],
): Promise<boolean> {
  note(
    entries.map(([key, scope]) => `${key}: ${scopeLabel(scope)}`).join('\n'),
    `Detected environment variables and build args for ${service}`,
  )
  return await promptConfirm({
    message: `Use these recommended runtime/build placements for "${service}"?`,
    initialValue: true,
  })
}

function scopeOptions(recommended: ConfigScope) {
  const order = [recommended, 'runtime', 'build', 'both'].filter(
    (value, index, list) => list.indexOf(value) === index,
  ) as ConfigScope[]
  return [
    ...order.map((scope) => ({
      value: scope,
      label: scopeLabel(scope),
      hint: scope === recommended ? 'Recommended' : undefined,
    })),
  ]
}

async function promptRequiredScope(
  service: string,
  key: string,
  recommended: ConfigScope,
): Promise<ConfigScope> {
  return await promptSelect({
    message: `Where should jib store ${key} for service "${service}"?`,
    options: scopeOptions(recommended),
    initialValue: recommended,
  })
}
