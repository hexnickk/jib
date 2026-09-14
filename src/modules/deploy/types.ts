import type { Config } from '@jib/config'
import type { Logger } from '@jib/logging'
import type { Paths } from '@jib/paths'

export const MIN_DISK_BYTES = 2 * 1024 * 1024 * 1024

export interface DeployDeps {
  config: Config
  paths: Paths
  stateDir: string
  log: Logger
}

// Approved exception to the ctx convention: pass a single progress callback directly.
export type DeployProgress = (step: string, message: string) => void

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
