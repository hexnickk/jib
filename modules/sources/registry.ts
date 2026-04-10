import type { App, Config } from '@jib/config'
import { githubDriver } from './github.ts'
import type { SourceDriver } from './types.ts'

const DRIVERS = new Map<string, SourceDriver>([[githubDriver.name, githubDriver]])

export function resolveSourceDriver(cfg: Config, app: App): SourceDriver {
  const name = app.source ? cfg.sources[app.source]?.driver : 'github'
  if (!name) {
    throw new Error(`source "${app.source}" not found in config`)
  }
  const driver = DRIVERS.get(name)
  if (!driver) {
    throw new Error(`source driver "${name}" is not registered`)
  }
  return driver
}
