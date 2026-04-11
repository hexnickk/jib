import { ValidationError } from '@jib/errors'
import type { ConfigEntry, ConfigScope, EnvEntry } from './types.ts'

export function includesRuntime(scope: ConfigScope): boolean {
  return scope === 'runtime' || scope === 'both'
}

export function includesBuild(scope: ConfigScope): boolean {
  return scope === 'build' || scope === 'both'
}

export function scopeCovers(scope: ConfigScope, required: ConfigScope): boolean {
  return (
    (!includesRuntime(required) || includesRuntime(scope)) &&
    (!includesBuild(required) || includesBuild(scope))
  )
}

export function mergeConfigEntries(entries: ConfigEntry[]): ConfigEntry[] {
  const merged = new Map<string, ConfigEntry>()
  for (const entry of entries) {
    const existing = merged.get(entry.key)
    if (!existing) {
      merged.set(entry.key, { ...entry })
      continue
    }
    if (existing.value !== entry.value) {
      throw new ValidationError(
        `conflicting values for "${entry.key}" - use one value across runtime/build flags`,
      )
    }
    merged.set(entry.key, {
      key: entry.key,
      value: entry.value,
      scope: unionScopes(existing.scope, entry.scope),
    })
  }
  return [...merged.values()]
}

export function configEntriesToBuildArgs(
  entries: ConfigEntry[],
): Record<string, string> | undefined {
  const out = Object.fromEntries(
    entries.filter((entry) => includesBuild(entry.scope)).map((entry) => [entry.key, entry.value]),
  )
  return Object.keys(out).length > 0 ? out : undefined
}

export function configEntriesToRuntime(entries: ConfigEntry[]): EnvEntry[] {
  return entries
    .filter((entry) => includesRuntime(entry.scope))
    .map(({ key, value }) => ({ key, value }))
}

export function unionScopes(left: ConfigScope, right: ConfigScope): ConfigScope {
  if (left === right) return left
  return includesRuntime(left) || includesRuntime(right)
    ? includesBuild(left) || includesBuild(right)
      ? 'both'
      : 'runtime'
    : 'build'
}

export function inferScope(runtimeRef: boolean, buildRef: boolean): ConfigScope {
  if (runtimeRef && buildRef) return 'both'
  return buildRef ? 'build' : 'runtime'
}

export function scopeLabel(scope: ConfigScope): string {
  switch (scope) {
    case 'runtime':
      return 'runtime only'
    case 'build':
      return 'build only'
    case 'both':
      return 'build + runtime'
  }
}
