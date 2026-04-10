import type { App } from '@jib/config'
import type { GitEnv, lsRemote } from './git.ts'

export interface SourceTarget {
  app: string
  repo?: string | undefined
  branch?: string | undefined
  provider?: string | undefined
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

export interface ProbeSourceDeps {
  lsRemote?: typeof lsRemote
}
