import type { ParsedDomain } from '@jib/config'
import type { ComposeService } from '@jib/docker'
import type { JibError } from '@jib/errors'
import {
  tuiIsInteractive,
  tuiNote,
  tuiPromptConfirmResult,
  tuiPromptLinesResult,
  tuiPromptSelectResult,
  tuiPromptStringOptionalResult,
  tuiPromptStringResult,
} from '@jib/tui'
import { addScopeLabel } from './config-entries.ts'
import {
  addDetectedConfigScopes,
  addParseEnvEntry,
  addShouldDefaultExposeService,
  addSplitCommaValues,
  addSummarizeComposeServices,
  addValidateEnvEntry,
} from './guided.ts'
import type { ConfigEntry, ConfigScope } from './types.ts'

const MANUAL_CONFIG_LINES = [
  'Enter additional environment variables as KEY=VALUE, one per line.',
  'New entries are written to the app .env file.',
  'Compose can use the same .env values for runtime environment and build args.',
  'Press Enter on a blank line when finished.',
]

/** Prompts for per-service exposure and config values during the guided add flow. */
export async function addPromptForServices(
  domains: ParsedDomain[],
  composeServices: ComposeService[],
): Promise<
  | JibError
  | { service: string; expose: boolean; domainHosts: string[]; configEntries: ConfigEntry[] }[]
> {
  const summaries = addSummarizeComposeServices(composeServices)
  const answers = []

  for (const service of summaries) {
    const existingDomains = domains.filter((domain) => domain.service === service.name)
    let expose = existingDomains.length > 0
    if (!expose && tuiIsInteractive()) {
      const confirm = await tuiPromptConfirmResult({
        message: `Expose service "${service.name}" with a domain?`,
        initialValue: addShouldDefaultExposeService(service, summaries.length),
      })
      if (confirm instanceof Error) {
        return confirm
      }
      expose = confirm
    }
    let nextDomainHosts: string[] = []
    if (tuiIsInteractive() && expose && existingDomains.length === 0) {
      const hosts = await tuiPromptStringResult({
        message: `Domain(s) for service "${service.name}" (comma-separated)`,
        placeholder: 'app.example.com',
      })
      if (hosts instanceof Error) {
        return hosts
      }
      nextDomainHosts = addSplitCommaValues(hosts)
    }

    const detectedEntries = [...addDetectedConfigScopes(service)]

    const configEntries: ConfigEntry[] = []
    if (tuiIsInteractive() && detectedEntries.length > 0) {
      const useRecommended = await confirmRecommendedScopes(service.name, detectedEntries)
      if (useRecommended instanceof Error) {
        return useRecommended
      }
      for (const [key, detectedScope] of detectedEntries) {
        const scope = useRecommended
          ? detectedScope
          : await tuiPromptSelectResult({
              message: `Where should jib store ${key} for service "${service.name}"?`,
              options: scopeOptions(detectedScope),
              initialValue: detectedScope,
            })
        if (scope instanceof Error) {
          return scope
        }
        const value = await tuiPromptStringOptionalResult({
          message: `Value for ${key} (optional, leave blank to skip)`,
          placeholder: scope === 'build' ? 'https://example.com' : 'secret-or-value',
        })
        if (value instanceof Error) {
          return value
        }
        if (value.length === 0) {
          continue
        }
        configEntries.push({ key, value, scope })
      }
    }

    const manual = await promptAdditionalConfig(service.name)
    if (manual instanceof Error) {
      return manual
    }
    for (const raw of manual) {
      const base = addParseEnvEntry(raw)
      if (base instanceof Error) {
        return base
      }
      configEntries.push({ ...base, scope: 'runtime' })
    }

    answers.push({ service: service.name, expose, domainHosts: nextDomainHosts, configEntries })
  }

  return answers
}

async function promptAdditionalConfig(service: string): Promise<string[] | JibError> {
  if (!tuiIsInteractive()) {
    return []
  }
  const confirm = await tuiPromptConfirmResult({
    message: `Add more .env variables for "${service}"?`,
    initialValue: false,
  })
  if (confirm instanceof Error) {
    return confirm
  }
  if (!confirm) {
    return []
  }
  return tuiPromptLinesResult({
    title: `Additional .env variables for "${service}"`,
    lines: MANUAL_CONFIG_LINES,
    promptLabel: 'var',
    validateLine: addValidateEnvEntry,
  })
}

function scopeSummaryLabel(scope: ConfigScope): string {
  switch (scope) {
    case 'runtime':
      return 'runtime env var'
    case 'build':
      return 'build var'
    case 'both':
      return 'runtime env var + build var'
  }
}

async function confirmRecommendedScopes(
  service: string,
  entries: [string, ConfigScope][],
): Promise<boolean | JibError> {
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
