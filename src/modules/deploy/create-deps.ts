import type { Config } from '@jib/config'
import { loggingCreateLogger } from '@jib/logging'
import type { Paths } from '@jib/paths'
import { stateCreateStore } from '@jib/state'
import type { DeployDeps } from './types.ts'

/** Builds the shared dependency bundle used by deploy commands and workflows. */
export function deployCreateDeps(config: Config, paths: Paths, name = 'deploy'): DeployDeps {
  return {
    config,
    paths,
    store: stateCreateStore(paths.stateDir),
    log: loggingCreateLogger(name),
  }
}
