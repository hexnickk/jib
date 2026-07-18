import type { App, Config, Domain, HealthCheck, ParsedDomain } from '@jib/config'
import type { ComposeInspection, ComposeService } from '@jib/docker'
import type { JibError } from '@jib/errors'
import type { Paths } from '@jib/paths'
import type { InspectionCheckout } from '@jib/sources'

export type EnvEntry = { key: string; value: string }

export type ConfigScope = 'runtime' | 'build' | 'both'

export interface ConfigEntry extends EnvEntry {
  scope: ConfigScope
}

export interface AddInputs {
  repo: string
  persistPaths: string[]
  ingressDefault: string
  composeRaw?: string[]
  parsedDomains: ParsedDomain[]
  configEntries: ConfigEntry[]
  healthChecks: HealthCheck[]
}

export interface GuidedInputs {
  domains: Domain[]
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
  paths: Paths
  draftApp: App
  signal?: { readonly cancelled: boolean }
}

export type AddFlowResult = { finalApp: App; secretsWritten: number }
export type AddFlowOutcome = AddFlowResult | JibError

export interface AddPlanner {
  inspectCompose(draftApp: App, workdir: string): Promise<ComposeInspection | JibError>
  collectGuidedInputs(
    inputs: AddInputs,
    services: ComposeService[],
  ): Promise<GuidedInputs | JibError>
  buildResolvedApp(
    cfg: Config,
    paths: Paths,
    appName: string,
    workdir: string,
    args: { source?: string; branch?: string },
    inputs: AddInputs,
    inspection: ComposeInspection,
    guided: GuidedInputs,
  ): Promise<App | JibError>
  confirmPlan(
    appName: string,
    inspection: ComposeInspection,
    finalApp: App,
    configEntries: ConfigEntry[],
  ): Promise<undefined | JibError>
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
  ): Promise<InspectionCheckout | JibError>
  removeCheckout(appName: string, repo: string): Promise<undefined | JibError>
  loadConfig(configFile: string): Promise<Config | JibError>
  writeConfig(configFile: string, cfg: Config): Promise<undefined | JibError>
  upsertSecret(appName: string, entry: EnvEntry): Promise<undefined | JibError>
  removeSecret(appName: string, key: string): Promise<undefined | JibError>
  removeManagedCompose(appName: string): Promise<undefined | JibError>
  claimIngress(appName: string, finalApp: App): Promise<undefined | JibError>
}
