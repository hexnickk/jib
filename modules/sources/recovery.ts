import type { Config } from '@jib/config'
import { loggingCreateLogger } from '@jib/logging'
import type { Paths } from '@jib/paths'
import { sourceDriver, sourceDrivers } from './registry.ts'
import type { SourceSelectOption, SourceSetupOption, SourceStatus } from './types.ts'

export function sourcesConfiguredOptions(cfg: Config): SourceSelectOption[] {
  return Object.entries(cfg.sources).map(([name, source]) => {
    const driver = sourceDriver(source.driver)
    return {
      value: `existing:${name}`,
      label: name,
      ...(driver ? { hint: driver.describe(source) } : {}),
    }
  })
}

export function sourcesAvailableSetupOptions(): SourceSetupOption[] {
  return sourceDrivers().flatMap((driver) =>
    driver.setup ? [{ value: driver.name, label: driver.setupLabel ?? driver.name }] : [],
  )
}

export function sourcesRepoSupportsRecovery(repo: string): boolean {
  return sourceDrivers().some((driver) => driver.supportsRepo(repo))
}

export function sourcesRepoHasAuthFailure(repo: string, error: unknown): boolean {
  return sourceDrivers().some((driver) => driver.supportsRepo(repo) && driver.isAuthFailure(error))
}

/** Runs the selected source-driver setup flow and returns the created source name, if any. */
export async function sourcesRunSetup(
  cfg: Config,
  paths: Paths,
  value: string,
): Promise<string | null> {
  const driver = sourceDriver(value)
  if (!driver?.setup) return null
  return driver.setup({ config: cfg, logger: loggingCreateLogger('sources'), paths })
}

export async function sourcesCollectStatuses(cfg: Config, paths: Paths): Promise<SourceStatus[]> {
  const results: SourceStatus[] = []
  for (const [name, source] of Object.entries(cfg.sources)) {
    const driver = sourceDriver(source.driver)
    if (!driver) {
      results.push({
        name,
        driver: source.driver,
        detail: `${source.driver} source`,
        hasCredential: false,
      })
      continue
    }
    const status = await driver.describeStatus(name, source, paths)
    results.push({ name, driver: source.driver, ...status })
  }
  return results
}
