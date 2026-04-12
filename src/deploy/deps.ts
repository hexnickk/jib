import type { Config } from '@jib/config'
import type { DeployDeps } from '@jib/deploy'
import { createLogger } from '@jib/logging'
import type { Paths } from '@jib/paths'
import { Store } from '@jib/state'

/** Builds the shared dependency bundle used by deploy commands and workflows. */
export function deployCreateDeps(config: Config, paths: Paths, name = 'deploy'): DeployDeps {
  return {
    config,
    paths,
    store: new Store(paths.stateDir),
    log: createLogger(name),
  }
}
