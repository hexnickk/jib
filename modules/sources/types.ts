import type { App, Config } from '@jib/config'
import type { Paths } from '@jib/core'
import type { GitEnv, lsRemote } from './git.ts'

export interface SourceTarget {
  app: string
  repo?: string | undefined
  branch?: string | undefined
  source?: string | undefined
}

export interface PreparedSource {
  workdir: string
  sha: string
}

export interface SourceProbe {
  workdir: string
  sha: string
}

export interface ResolvedSource {
  app: App
  branch: string
  env: GitEnv
  external: boolean
  ref: string
  url: string
  workdir: string
  applyAuth: (workdir: string) => Promise<void>
}

export interface ResolvedDriverSource {
  env: GitEnv
  external: boolean
  url: string
  applyAuth: (workdir: string) => Promise<void>
}

export interface SourceDriver {
  name: string
  resolve(cfg: Config, app: App, paths: Paths): Promise<ResolvedDriverSource>
}

export interface ProbeSourceDeps {
  lsRemote?: typeof lsRemote
}
