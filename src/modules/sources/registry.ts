import type { App, Config } from '@jib/config'
import { NotFoundError, ValidationError } from '@jib/errors'
import { githubDriver } from './backend/github/driver.ts'
import type { SourceDriver } from './types.ts'

const DRIVERS = new Map<string, SourceDriver>([[githubDriver.name, githubDriver]])

export function sourceDrivers(): SourceDriver[] {
  return [...DRIVERS.values()]
}

export function sourceDriver(name: string): SourceDriver | undefined {
  return DRIVERS.get(name)
}

/** Resolves the configured source driver or returns a shared input/absence error. */
export function resolveSourceDriverResult(
  cfg: Config,
  app: App,
): SourceDriver | NotFoundError | ValidationError {
  const sourceName = app.source
  const name = sourceName ? cfg.sources[sourceName]?.driver : 'github'
  if (!name) {
    return new NotFoundError(`source "${sourceName ?? 'unknown'}" not found in config`)
  }
  const driver = sourceDriver(name)
  if (!driver) {
    return new ValidationError(`source driver "${name}" is not registered`)
  }
  return driver
}
