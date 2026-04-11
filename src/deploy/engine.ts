import type { Config } from '@jib/config'
import { Engine } from '@jib/deploy'
import { createLogger } from '@jib/logging'
import type { Paths } from '@jib/paths'
import { Store } from '@jib/state'

export function createDeployEngine(config: Config, paths: Paths, name = 'deploy'): Engine {
  return new Engine({
    config,
    paths,
    store: new Store(paths.stateDir),
    log: createLogger(name),
  })
}
