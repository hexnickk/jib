import type { App, Config, HealthCheck, ParsedDomain } from '@jib/config'
import type { ComposeInspection, ComposeService } from '@jib/docker'

export type EnvEntry = { key: string; value: string }

export interface AddInputs {
  repo: string
  ingressDefault: string
  composeRaw?: string[]
  parsedDomains: ParsedDomain[]
  envEntries: EnvEntry[]
  healthChecks: HealthCheck[]
}

export interface GuidedInputs {
  domains: ParsedDomain[]
  envEntries: EnvEntry[]
  secretKeys: string[]
}

export type AddFlowState =
  | 'inputs_ready'
  | 'repo_prepared'
  | 'compose_inspected'
  | 'guided_inputs_collected'
  | 'app_resolved'
  | 'confirmed'
  | 'config_written'
  | 'secrets_written'
  | 'routes_claimed'

export interface AddFlowParams {
  appName: string
  args: { 'git-provider'?: string }
  cfg: Config
  configFile: string
  inputs: AddInputs
  draftApp: App
}

export type AddFlowResult = { finalApp: App; secretsWritten: number }

export interface AddRepoService {
  prepare(
    appName: string,
    target: { repo: string; branch: string; provider?: string },
  ): Promise<{ workdir: string }>
  rollback(appName: string, repo: string): Promise<void>
}

export interface AddPlanner {
  inspectCompose(draftApp: App, workdir: string): Promise<ComposeInspection>
  collectGuidedInputs(inputs: AddInputs, services: ComposeService[]): Promise<GuidedInputs>
  buildResolvedApp(
    cfg: Config,
    appName: string,
    workdir: string,
    args: { 'git-provider'?: string },
    inputs: AddInputs,
    inspection: ComposeInspection,
    guided: GuidedInputs,
  ): Promise<App>
  confirmPlan(
    appName: string,
    inspection: ComposeInspection,
    finalApp: App,
    secretKeys: string[],
  ): Promise<void>
}

export interface AddConfigStore {
  write(configFile: string, cfg: Config): Promise<void>
  load(configFile: string): Promise<Config>
}

export interface AddSecretStore {
  upsert(appName: string, entry: EnvEntry, envFile: string): Promise<void>
  remove(appName: string, key: string, envFile: string): Promise<void>
}

export interface AddIngressService {
  claim(appName: string, finalApp: App): Promise<void>
}

export interface AddFlowObserver {
  onStateChange?(state: AddFlowState): void
  warn?(message: string): void
}

export interface AddFlowServices extends AddFlowObserver {
  repo: AddRepoService
  planner: AddPlanner
  config: AddConfigStore
  secrets: AddSecretStore
  ingress: AddIngressService
}

export interface CleanupState {
  preparedRepo: boolean
  configWritten: boolean
  finalEnvFile: string
  writtenSecretKeys: string[]
}
