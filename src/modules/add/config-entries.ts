import { ValidationError } from '@jib/errors'
import type { ConfigEntry, ConfigScope, EnvEntry } from './types.ts'

/** Returns true when a scope contributes runtime environment variables. */
export function addIncludesRuntime(scope: ConfigScope): boolean {
  return scope === 'runtime' || scope === 'both'
}

/** Returns true when a scope contributes docker build arguments. */
export function addIncludesBuild(scope: ConfigScope): boolean {
  return scope === 'build' || scope === 'both'
}

/** Returns true when `scope` satisfies every requirement in `required`. */
export function addScopeCovers(scope: ConfigScope, required: ConfigScope): boolean {
  return (
    (!addIncludesRuntime(required) || addIncludesRuntime(scope)) &&
    (!addIncludesBuild(required) || addIncludesBuild(scope))
  )
}

/** Merges config entries by key, upgrading compatible scopes and rejecting conflicts. */
export function addMergeConfigEntries(entries: ConfigEntry[]): ConfigEntry[] {
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
      scope: addUnionScopes(existing.scope, entry.scope),
    })
  }
  return [...merged.values()]
}

/** Extracts only build-visible config entries into a build-arg map. */
export function addConfigEntriesToBuildArgs(
  entries: ConfigEntry[],
): Record<string, string> | undefined {
  const out = Object.fromEntries(
    entries
      .filter((entry) => addIncludesBuild(entry.scope))
      .map((entry) => [entry.key, entry.value]),
  )
  return Object.keys(out).length > 0 ? out : undefined
}

/** Extracts only runtime-visible config entries into env-file entries. */
export function addConfigEntriesToRuntime(entries: ConfigEntry[]): EnvEntry[] {
  return entries
    .filter((entry) => addIncludesRuntime(entry.scope))
    .map(({ key, value }) => ({ key, value }))
}

/** Unions two scopes into the smallest scope that covers both. */
export function addUnionScopes(left: ConfigScope, right: ConfigScope): ConfigScope {
  if (left === right) return left
  return addIncludesRuntime(left) || addIncludesRuntime(right)
    ? addIncludesBuild(left) || addIncludesBuild(right)
      ? 'both'
      : 'runtime'
    : 'build'
}

/** Infers the narrowest scope that covers the observed runtime/build usage. */
export function addInferScope(runtimeRef: boolean, buildRef: boolean): ConfigScope {
  if (runtimeRef && buildRef) return 'both'
  return buildRef ? 'build' : 'runtime'
}

/** Formats a scope label for interactive add-flow prompts. */
export function addScopeLabel(scope: ConfigScope): string {
  switch (scope) {
    case 'runtime':
      return 'runtime only'
    case 'build':
      return 'build only'
    case 'both':
      return 'build + runtime'
  }
}
