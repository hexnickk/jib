import type { App, Config, HealthCheck, ParsedDomain } from '@jib/config'
import type { ComposeInspection, ComposeService } from '@jib/docker'
import type { InspectionCheckout } from '@jib/sources'

export type EnvEntry = { key: string; value: string }

export type ConfigScope = 'runtime' | 'build' | 'both'

export interface ConfigEntry extends EnvEntry {
  scope: ConfigScope
}

export interface AddInputs {
  repo: string
  ingressDefault: string
  composeRaw?: string[]
  parsedDomains: ParsedDomain[]
  configEntries: ConfigEntry[]
  healthChecks: HealthCheck[]
}

export interface GuidedInputs {
  domains: ParsedDomain[]
  configEntries: ConfigEntry[]
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
  args: { source?: string; branch?: string }
  cfg: Config
  configFile: string
  inputs: AddInputs
  draftApp: App
}

export type AddFlowResult = { finalApp: App; secretsWritten: number }

export interface AddPlanner {
  inspectCompose(draftApp: App, workdir: string): Promise<ComposeInspection>
  collectGuidedInputs(inputs: AddInputs, services: ComposeService[]): Promise<GuidedInputs>
  buildResolvedApp(
    cfg: Config,
    appName: string,
    workdir: string,
    args: { source?: string; branch?: string },
    inputs: AddInputs,
    inspection: ComposeInspection,
    guided: GuidedInputs,
  ): Promise<App>
  confirmPlan(
    appName: string,
    inspection: ComposeInspection,
    finalApp: App,
    configEntries: ConfigEntry[],
  ): Promise<void>
}

export interface AddFlowObserver {
  onStateChange?(state: AddFlowState): void
  warn?(message: string): void
}

export interface AddSupport {
  cloneForInspection(
    cfg: Config,
    appName: string,
    target: { repo: string; branch: string; source?: string },
  ): Promise<InspectionCheckout>
  removeCheckout(appName: string, repo: string): Promise<void>
  loadConfig(configFile: string): Promise<Config>
  writeConfig(configFile: string, cfg: Config): Promise<void>
  upsertSecret(appName: string, entry: EnvEntry, envFile: string): Promise<void>
  removeSecret(appName: string, key: string, envFile: string): Promise<void>
  claimIngress(appName: string, finalApp: App): Promise<void>
}

export interface CleanupState {
  preparedRepo: boolean
  configWritten: boolean
  finalEnvFile: string
  writtenSecretKeys: string[]
}
