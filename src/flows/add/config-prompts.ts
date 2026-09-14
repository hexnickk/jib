import type { ComposeService } from '@jib/docker'
import type { JibError } from '@jib/errors'
import {
  tuiIsInteractive,
  tuiNote,
  tuiPromptConfirmResult,
  tuiPromptLinesResult,
  tuiPromptSelectResult,
  tuiPromptStringOptionalResult,
} from '@jib/tui'
import { addScopeLabel } from './config-entries.ts'
import { addDetectedConfigScopes, addParseEnvEntry, addValidateEnvEntry } from './guided.ts'
import type { ConfigEntry } from './types.ts'

/** Collects one app-wide set of variables after service/domain setup is complete. */
export async function addPromptForConfig(
  composeServices: ComposeService[],
  supplied: ConfigEntry[],
): Promise<ConfigEntry[] | JibError> {
  if (!tuiIsInteractive()) {
    return []
  }
  const suppliedKeys = new Set(supplied.map((entry) => entry.key))
  const detected = [...addDetectedConfigScopes(composeServices)].filter(
    ([key]) => !suppliedKeys.has(key),
  )
  const entries: ConfigEntry[] = []
  if (detected.length > 0) {
    tuiNote(
      [
        'Values are stored once in the app .env file; Compose controls which services use them.',
        ...detected.map(([key, scope]) => `${key}: ${addScopeLabel(scope)}`),
      ].join('\n'),
      'Detected app variables from Compose',
    )
    const useRecommended = await tuiPromptConfirmResult({
      message: 'Use these runtime/build placements for the app variables?',
      initialValue: true,
    })
    if (useRecommended instanceof Error) {
      return useRecommended
    }
    for (const [key, detectedScope] of detected) {
      const scope = useRecommended
        ? detectedScope
        : await tuiPromptSelectResult({
            message: `How should ${key} be used for this app?`,
            options: [...new Set([detectedScope, 'runtime', 'build', 'both'] as const)].map(
              (value) => ({
                value,
                label: addScopeLabel(value),
                ...(value === detectedScope ? { hint: 'Recommended' } : {}),
              }),
            ),
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
      if (value.length > 0) {
        entries.push({ key, value, scope })
      }
    }
  }
  const additional = await tuiPromptConfirmResult({
    message: 'Add more .env variables for this app?',
    initialValue: false,
  })
  if (additional instanceof Error) {
    return additional
  }
  if (additional) {
    const lines = await tuiPromptLinesResult({
      title: 'Additional app .env variables',
      lines: [
        'Enter additional environment variables as KEY=VALUE, one per line.',
        'New entries are written to the app .env file.',
        'Compose can use the same .env values for runtime environment and build args.',
        'Press Enter on a blank line when finished.',
      ],
      promptLabel: 'var',
      validateLine: addValidateEnvEntry,
    })
    if (lines instanceof Error) {
      return lines
    }
    for (const raw of lines) {
      const entry = addParseEnvEntry(raw)
      if (entry instanceof Error) {
        return entry
      }
      entries.push({ ...entry, scope: 'runtime' })
    }
  }
  return entries
}
