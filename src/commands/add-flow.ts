import type { App, Config, HealthCheck, ParsedDomain } from '@jib/config'
import { CliError, JibError, ValidationError } from '@jib/core'
import { type ComposeInspection, ComposeInspectionError, type ComposeService } from '@jib/docker'

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

export interface AddFlowDeps {
  prepareRepo: (
    appName: string,
    target: { repo: string; branch: string; provider?: string },
  ) => Promise<{ workdir: string }>
  inspectCompose: (draftApp: App, workdir: string) => Promise<ComposeInspection>
  collectGuidedInputs: (
    inputs: AddInputs,
    composeServices: ComposeService[],
  ) => Promise<GuidedInputs>
  buildResolvedApp: (
    cfg: Config,
    appName: string,
    workdir: string,
    args: { 'git-provider'?: string },
    inputs: AddInputs,
    inspection: ComposeInspection,
    guided: GuidedInputs,
  ) => Promise<App>
  confirmPlan: (
    appName: string,
    inspection: ComposeInspection,
    finalApp: App,
    secretKeys: string[],
  ) => Promise<void>
  writeConfig: (configFile: string, cfg: Config) => Promise<void>
  loadConfig: (configFile: string) => Promise<Config>
  upsertSecret: (appName: string, entry: EnvEntry, envFile: string) => Promise<void>
  removeSecret: (appName: string, key: string, envFile: string) => Promise<void>
  claimRoutes: (appName: string, finalApp: App) => Promise<void>
  rollbackRepo: (appName: string, repo: string) => Promise<void>
  onStateChange?: (state: AddFlowState) => void
  warn?: (message: string) => void
}

export interface AddFlowParams {
  appName: string
  args: { 'git-provider'?: string }
  cfg: Config
  configFile: string
  inputs: AddInputs
  draftApp: App
}

export type AddFlowResult = { finalApp: App; secretsWritten: number }

interface CleanupState {
  preparedRepo: boolean
  configWritten: boolean
  finalEnvFile: string
  writtenSecretKeys: string[]
}

export async function runAddFlow(params: AddFlowParams, deps: AddFlowDeps): Promise<AddFlowResult> {
  const cleanup: CleanupState = {
    preparedRepo: false,
    configWritten: false,
    finalEnvFile: '.env',
    writtenSecretKeys: [],
  }
  deps.onStateChange?.('inputs_ready')
  try {
    const { workdir } = await deps.prepareRepo(params.appName, {
      repo: params.inputs.repo,
      branch: 'main',
      ...(params.args['git-provider'] ? { provider: params.args['git-provider'] } : {}),
    })
    cleanup.preparedRepo = true
    deps.onStateChange?.('repo_prepared')
    const inspection = await deps.inspectCompose(params.draftApp, workdir)
    deps.onStateChange?.('compose_inspected')
    const guided = await deps.collectGuidedInputs(params.inputs, inspection.services)
    deps.onStateChange?.('guided_inputs_collected')
    const finalApp = await deps.buildResolvedApp(
      params.cfg,
      params.appName,
      workdir,
      params.args,
      params.inputs,
      inspection,
      guided,
    )
    deps.onStateChange?.('app_resolved')
    await deps.confirmPlan(params.appName, inspection, finalApp, guided.secretKeys)
    deps.onStateChange?.('confirmed')
    const finalCfg: Config = {
      ...params.cfg,
      apps: { ...params.cfg.apps, [params.appName]: finalApp },
    }
    await deps.writeConfig(params.configFile, finalCfg)
    cleanup.configWritten = true
    cleanup.finalEnvFile = finalApp.env_file
    deps.onStateChange?.('config_written')
    for (const entry of guided.envEntries) {
      await deps.upsertSecret(params.appName, entry, finalApp.env_file)
      cleanup.writtenSecretKeys.push(entry.key)
    }
    deps.onStateChange?.('secrets_written')
    await deps.claimRoutes(params.appName, finalApp)
    deps.onStateChange?.('routes_claimed')
    return { finalApp, secretsWritten: guided.envEntries.length }
  } catch (error) {
    await cleanupFailedAdd(params, deps, cleanup)
    throw normalizeAddError(error, params.appName, params.configFile)
  }
}

async function cleanupFailedAdd(
  params: AddFlowParams,
  deps: AddFlowDeps,
  state: CleanupState,
): Promise<void> {
  if (state.preparedRepo) {
    try {
      await deps.rollbackRepo(params.appName, params.inputs.repo)
    } catch (error) {
      deps.warn?.(`repo rollback: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
  for (const key of state.writtenSecretKeys) {
    try {
      await deps.removeSecret(params.appName, key, state.finalEnvFile)
    } catch (error) {
      deps.warn?.(
        `secret cleanup (${key}): ${error instanceof Error ? error.message : String(error)}`,
      )
    }
  }
  if (!state.configWritten) return

  try {
    const current = await deps.loadConfig(params.configFile).catch((error) => {
      deps.warn?.(
        `config cleanup load: ${error instanceof Error ? error.message : String(error)}; falling back to original snapshot`,
      )
      return params.cfg
    })
    const rollbackApps = { ...current.apps }
    delete rollbackApps[params.appName]
    await deps.writeConfig(params.configFile, { ...current, apps: rollbackApps })
  } catch (error) {
    deps.warn?.(`config cleanup: ${error instanceof Error ? error.message : String(error)}`)
  }
}

export function normalizeAddError(error: unknown, appName: string, configFile: string): Error {
  if (error instanceof CliError || error instanceof ValidationError) {
    return error
  }
  if (error instanceof ComposeInspectionError) {
    return new CliError('compose_inspection_failed', error.message)
  }
  if (
    error instanceof JibError &&
    error.code === 'rpc.failure' &&
    error.message === `app "${appName}" not found in config`
  ) {
    return new CliError('add_failed', error.message, {
      hint: 'running jib-gitsitter is older than this CLI; rebuild/install the current jib binary and restart jib-gitsitter, then retry `jib add ...`',
    })
  }
  return new CliError('add_failed', error instanceof Error ? error.message : String(error), {
    hint: `rolled back ${appName} from ${configFile}; safe to retry: jib add ...`,
  })
}
