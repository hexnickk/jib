import type { Config } from '@jib/config'
import type { CheckHealthOptions, DockerExec } from '@jib/docker'
import type { Logger } from '@jib/logging'
import type { Paths } from '@jib/paths'
import type { StateStore } from '@jib/state'

export const MIN_DISK_BYTES = 2 * 1024 * 1024 * 1024

export interface DeployDeps {
  config: Config
  paths: Paths
  store: StateStore
  log: Logger
  diskFree?: (path: string) => Promise<number>
  dockerExec?: DockerExec
  healthOpts?: CheckHealthOptions
}

export interface ProgressCtx {
  emit: (step: string, message: string) => void
}

export interface DeployCmd {
  app: string
  workdir: string
  sha: string
  trigger: 'manual' | 'auto'
  user?: string
}

export interface DeployResult {
  deployedSHA: string
  durationMs: number
}
