import type { Config } from '@jib/config'
import { type Paths, createLogger } from '@jib/core'
import { Engine } from '@jib/deploy'
import { Store } from '@jib/state'

export function createDeployEngine(config: Config, paths: Paths, name = 'deploy'): Engine {
  return new Engine({
    config,
    paths,
    store: new Store(paths.stateDir),
    log: createLogger(name),
  })
}
