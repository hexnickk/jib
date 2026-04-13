import type { App, Config } from '@jib/config'
import { githubDriver } from './backend/github/driver.ts'
import { SourceDriverNotRegisteredError, SourceMissingConfigError } from './errors.ts'
import type { SourceDriver } from './types.ts'

const DRIVERS = new Map<string, SourceDriver>([[githubDriver.name, githubDriver]])

export function sourceDrivers(): SourceDriver[] {
  return [...DRIVERS.values()]
}

export function sourceDriver(name: string): SourceDriver | undefined {
  return DRIVERS.get(name)
}

export function resolveSourceDriverResult(
  cfg: Config,
  app: App,
): SourceDriver | SourceDriverNotRegisteredError | SourceMissingConfigError {
  const sourceName = app.source
  const name = sourceName ? cfg.sources[sourceName]?.driver : 'github'
  if (!name) {
    return new SourceMissingConfigError(sourceName ?? 'unknown')
  }
  const driver = sourceDriver(name)
  if (!driver) {
    return new SourceDriverNotRegisteredError(name)
  }
  return driver
}
