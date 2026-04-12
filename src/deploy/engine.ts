import type { Config } from '@jib/config'
import { Engine, type EngineDeps } from '@jib/deploy'
import { createLogger } from '@jib/logging'
import type { Paths } from '@jib/paths'
import { Store } from '@jib/state'

/** Builds the shared deploy dependencies used by both engine and direct deploy actions. */
export function createDeployDeps(config: Config, paths: Paths, name = 'deploy'): EngineDeps {
  return {
    config,
    paths,
    store: new Store(paths.stateDir),
    log: createLogger(name),
  }
}

/** Creates the legacy deploy engine wrapper from the shared dependency bundle. */
export function createDeployEngine(config: Config, paths: Paths, name = 'deploy'): Engine {
  return new Engine(createDeployDeps(config, paths, name))
}
