import type { App, Config, Source } from '@jib/config'
import type { ModuleContext, Paths } from '@jib/core'
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

export interface InspectionCheckout {
  workdir: string
}

export interface SourceProbe {
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

export interface SourceSetupChoice {
  value: string
  label: string
  run(ctx: ModuleContext<Config>): Promise<string | null>
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

export interface SourceDriver {
  name: string
  resolve(cfg: Config, app: App, paths: Paths): Promise<ResolvedDriverSource>
  supportsRepo(repo: string): boolean
  isAuthFailure(error: unknown): boolean
  describe(source: Source): string
  describeStatus(sourceName: string, source: Source, paths: Paths): Promise<DriverSourceStatus>
  setupChoices(): readonly SourceSetupChoice[]
}

export interface ProbeSourceDeps {
  lsRemote?: typeof lsRemote
}
