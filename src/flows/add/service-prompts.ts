import { MissingInputError } from '@jib/cli'
import type { ParsedDomain } from '@jib/config'
import type { ComposeService } from '@jib/docker'
import {
  tuiIsInteractive,
  tuiNote,
  tuiPromptConfirmResult,
  tuiPromptLinesResult,
  tuiPromptSelectResult,
  tuiPromptStringResult,
} from '@jib/tui'
import { addMergeConfigEntries, addScopeCovers, addScopeLabel } from './config-entries.ts'
import {
  addParseEnvEntry,
  addRequiredConfigScopes,
  addShouldDefaultExposeService,
  addSplitCommaValues,
  addSummarizeComposeServices,
  addValidateEnvEntry,
} from './guided.ts'
import type { ConfigEntry, ConfigScope } from './types.ts'

const MANUAL_CONFIG_LINES = [
  'Enter additional environment variables as KEY=VALUE, one per line.',
  'New entries are added to the runtime .env file by default.',
  'If you need extra build args, add them to the app config after add completes.',
  'Press Enter on a blank line when finished.',
]

/** Prompts for per-service exposure and config values during the guided add flow. */
export async function addPromptForServices(
  domains: ParsedDomain[],
  composeServices: ComposeService[],
  initialEntries: ConfigEntry[],
): Promise<
  | MissingInputError
  | Error
  | { service: string; expose: boolean; domainHosts: string[]; configEntries: ConfigEntry[] }[]
> {
  const summaries = addSummarizeComposeServices(composeServices)
  const provided = new Map(initialEntries.map((entry) => [entry.key, entry]))
  const issues: { field: string; message: string }[] = []
  const answers = []

  for (const service of summaries) {
    const existingDomains = domains.filter((domain) => domain.service === service.name)
    let expose = existingDomains.length > 0
    if (!expose && tuiIsInteractive()) {
      const confirm = await tuiPromptConfirmResult({
        message: `Expose service "${service.name}" with a domain?`,
        initialValue: addShouldDefaultExposeService(service, summaries.length),
      })
      if (confirm instanceof Error) return confirm
      expose = confirm
    }
    let nextDomainHosts: string[] = []
    if (tuiIsInteractive() && expose && existingDomains.length === 0) {
      const hosts = await tuiPromptStringResult({
        message: `Domain(s) for service "${service.name}" (comma-separated)`,
        placeholder: 'app.example.com',
      })
      if (hosts instanceof Error) return hosts
      nextDomainHosts = addSplitCommaValues(hosts)
    }

    const requiredEntries = [...addRequiredConfigScopes(service)].filter(([key, requiredScope]) => {
      const existing = provided.get(key)
      return !(existing && addScopeCovers(existing.scope, requiredScope))
    })

    const configEntries: ConfigEntry[] = []
    if (!tuiIsInteractive()) {
      for (const [key, requiredScope] of requiredEntries) {
        issues.push({
          field: `env.${key}`,
          message: `${service.name} requires ${key} for ${addScopeLabel(requiredScope)}; rerun with --env ${key}=VALUE, --build-arg ${key}=VALUE, or --build-env ${key}=VALUE`,
        })
      }
    } else if (requiredEntries.length > 0) {
      const useRecommended = await confirmRecommendedScopes(service.name, requiredEntries)
      if (useRecommended instanceof Error) return useRecommended
      for (const [key, requiredScope] of requiredEntries) {
        const existing = provided.get(key)
        const scope = useRecommended
          ? requiredScope
          : await promptRequiredScope(service.name, key, requiredScope)
        if (scope instanceof Error) return scope
        const entry = {
          key,
          value: existing?.value ?? '',
          scope,
        } satisfies ConfigEntry
        if (!existing?.value) {
          const value = await tuiPromptStringResult({
            message: `Value for ${key}`,
            placeholder: scope === 'build' ? 'https://example.com' : 'secret-or-value',
          })
          if (value instanceof Error) return value
          entry.value = value
        }
        configEntries.push(entry)
        provided.set(key, mergeEntry(existing, entry))
      }
    }

    let addManual = false
    if (tuiIsInteractive()) {
      const confirm = await tuiPromptConfirmResult({
        message: `Add more runtime environment variables for "${service.name}"?`,
        initialValue: false,
      })
      if (confirm instanceof Error) return confirm
      addManual = confirm
    }
    if (addManual) {
      const manual = await tuiPromptLinesResult({
        title: `Additional runtime environment variables for "${service.name}"`,
        lines: MANUAL_CONFIG_LINES,
        promptLabel: 'var',
        validateLine: addValidateEnvEntry,
      })
      if (manual instanceof Error) return manual
      for (const raw of manual) {
        const base = addParseEnvEntry(raw)
        if (base instanceof Error) return base
        const existing = provided.get(base.key)
        const entry = { ...base, scope: existing?.scope ?? 'runtime' }
        configEntries.push(entry)
        provided.set(base.key, mergeEntry(existing, entry))
      }
    }

    answers.push({ service: service.name, expose, domainHosts: nextDomainHosts, configEntries })
  }

  if (issues.length > 0) {
    return new MissingInputError('missing required input for jib add', issues)
  }
  return answers
}

function mergeEntry(existing: ConfigEntry | undefined, next: ConfigEntry): ConfigEntry {
  const merged = addMergeConfigEntries(existing ? [existing, next] : [next])
  return (merged instanceof Error ? [next] : merged)[0] as ConfigEntry
}

function scopeSummaryLabel(scope: ConfigScope): string {
  switch (scope) {
    case 'runtime':
      return 'runtime env var'
    case 'build':
      return 'build arg'
    case 'both':
      return 'runtime env var + build arg'
  }
}

async function confirmRecommendedScopes(
  service: string,
  entries: [string, ConfigScope][],
): Promise<boolean | Error> {
  tuiNote(
    entries.map(([key, scope]) => `${key}: ${scopeSummaryLabel(scope)}`).join('\n'),
    `Detected variables from compose for ${service}`,
  )
  return await tuiPromptConfirmResult({
    message: `Use these placements for the detected variables in "${service}"?`,
    initialValue: true,
  })
}

function scopeOptions(recommended: ConfigScope) {
  const order = [recommended, 'runtime', 'build', 'both'].filter(
    (value, index, list) => list.indexOf(value) === index,
  ) as ConfigScope[]
  return order.map((scope) =>
    scope === recommended
      ? { value: scope, label: addScopeLabel(scope), hint: 'Recommended' }
      : { value: scope, label: addScopeLabel(scope) },
  )
}

async function promptRequiredScope(
  service: string,
  key: string,
  recommended: ConfigScope,
): Promise<ConfigScope | Error> {
  return await tuiPromptSelectResult({
    message: `Where should jib store ${key} for service "${service}"?`,
    options: scopeOptions(recommended),
    initialValue: recommended,
  })
}
