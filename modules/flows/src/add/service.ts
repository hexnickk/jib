import { cleanupFailedAdd } from './cleanup.ts'
import { normalizeAddError } from './errors.ts'
import type {
  AddFlowObserver,
  AddFlowParams,
  AddFlowResult,
  AddPlanner,
  AddSupport,
  CleanupState,
} from './types.ts'

export class AddService {
  constructor(
    private readonly support: AddSupport,
    private readonly planner: AddPlanner,
    private readonly observer: AddFlowObserver = {},
  ) {}

  async run(params: AddFlowParams): Promise<AddFlowResult> {
    const cleanup: CleanupState = {
      preparedRepo: false,
      configWritten: false,
      finalEnvFile: '.env',
      writtenSecretKeys: [],
    }

    this.observer.onStateChange?.('inputs_ready')

    try {
      const { workdir } = await this.support.cloneForInspection(params.cfg, params.appName, {
        repo: params.inputs.repo,
        branch: params.draftApp.branch,
        ...(params.args.source ? { source: params.args.source } : {}),
      })
      cleanup.preparedRepo = true
      this.observer.onStateChange?.('repo_prepared')

      const inspection = await this.planner.inspectCompose(params.draftApp, workdir)
      this.observer.onStateChange?.('compose_inspected')

      const guided = await this.planner.collectGuidedInputs(params.inputs, inspection.services)
      this.observer.onStateChange?.('guided_inputs_collected')

      const finalApp = await this.planner.buildResolvedApp(
        params.cfg,
        params.appName,
        workdir,
        params.args,
        params.inputs,
        inspection,
        guided,
      )
      this.observer.onStateChange?.('app_resolved')

      await this.planner.confirmPlan(params.appName, inspection, finalApp, guided.secretKeys)
      this.observer.onStateChange?.('confirmed')

      const finalCfg = {
        ...params.cfg,
        apps: { ...params.cfg.apps, [params.appName]: finalApp },
      }
      await this.support.writeConfig(params.configFile, finalCfg)
      cleanup.configWritten = true
      cleanup.finalEnvFile = finalApp.env_file
      this.observer.onStateChange?.('config_written')

      for (const entry of guided.envEntries) {
        await this.support.upsertSecret(params.appName, entry, finalApp.env_file)
        cleanup.writtenSecretKeys.push(entry.key)
      }
      this.observer.onStateChange?.('secrets_written')

      await this.support.claimIngress(params.appName, finalApp)
      this.observer.onStateChange?.('routes_claimed')

      return { finalApp, secretsWritten: guided.envEntries.length }
    } catch (error) {
      await cleanupFailedAdd(params, this.support, this.observer, cleanup)
      throw normalizeAddError(error, params.appName, params.configFile)
    }
  }
}
