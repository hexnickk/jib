import type { App, Config, Domain, HealthCheck, ParsedDomain } from '@jib/config'
import type { ComposeInspection } from '@jib/docker'
import type { Paths } from '@jib/paths'

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

export interface AddResolveInput {
  appName: string
  workdir: string
  args: { source?: string; branch?: string }
  inputs: AddInputs
  inspection: ComposeInspection
  guided: GuidedInputs
}

export interface AddFlowObserver {
  onStateChange?(state: AddFlowState): void
}
