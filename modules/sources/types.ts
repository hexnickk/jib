import type { App, Config, Source } from '@jib/config'
import type { Logger } from '@jib/logging'
import type { Paths } from '@jib/paths'
import type { GitEnv } from './git.ts'

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

export interface InspectionCheckout {
  workdir: string
}

export interface SourceProbe {
  branch: string
  workdir: string
  sha: string
}

export interface ResolvedSource {
  app: App
  branch: string
  env: GitEnv
  ref: string
  url: string
  workdir: string
  applyAuth: (workdir: string) => Promise<void>
}

export interface ResolvedDriverSource {
  env: GitEnv
  url: string
  applyAuth: (workdir: string) => Promise<void>
}

export interface SourceSetupOption {
  value: string
  label: string
}

export interface SourceSelectOption {
  value: string
  label: string
  hint?: string
}

export interface SourceStatus {
  name: string
  driver: string
  detail: string
  hasCredential: boolean
}

export interface DriverSourceStatus {
  detail: string
  hasCredential: boolean
}

export interface SourceSetupContext {
  config: Config
  logger: Logger
  paths: Paths
}

export interface SourceDriver {
  name: string
  setupLabel?: string
  setup?: (ctx: SourceSetupContext) => Promise<string | null>
  resolve(cfg: Config, app: App, paths: Paths): Promise<ResolvedDriverSource>
  supportsRepo(repo: string): boolean
  isAuthFailure(error: unknown): boolean
  describe(source: Source): string
  describeStatus(sourceName: string, source: Source, paths: Paths): Promise<DriverSourceStatus>
}

export interface ProbeSourceDeps {
  lsRemote?: SourceLsRemote
}

export type SourceLsRemote = (url: string, ref?: string, env?: GitEnv) => Promise<string | Error>
