import { cleanupFailedAdd } from './cleanup.ts'
import { normalizeAddError } from './errors.ts'
import type { AddFlowParams, AddFlowResult, AddFlowServices, CleanupState } from './types.ts'

export class AddFlow {
  constructor(private readonly services: AddFlowServices) {}

  async run(params: AddFlowParams): Promise<AddFlowResult> {
    const cleanup: CleanupState = {
      preparedRepo: false,
      configWritten: false,
      finalEnvFile: '.env',
      writtenSecretKeys: [],
    }

    this.services.onStateChange?.('inputs_ready')

    try {
      const { workdir } = await this.services.repo.prepare(params.appName, {
        repo: params.inputs.repo,
        branch: 'main',
        ...(params.args.source ? { source: params.args.source } : {}),
      })
      cleanup.preparedRepo = true
      this.services.onStateChange?.('repo_prepared')

      const inspection = await this.services.planner.inspectCompose(params.draftApp, workdir)
      this.services.onStateChange?.('compose_inspected')

      const guided = await this.services.planner.collectGuidedInputs(
        params.inputs,
        inspection.services,
      )
      this.services.onStateChange?.('guided_inputs_collected')

      const finalApp = await this.services.planner.buildResolvedApp(
        params.cfg,
        params.appName,
        workdir,
        params.args,
        params.inputs,
        inspection,
        guided,
      )
      this.services.onStateChange?.('app_resolved')

      await this.services.planner.confirmPlan(
        params.appName,
        inspection,
        finalApp,
        guided.secretKeys,
      )
      this.services.onStateChange?.('confirmed')

      const finalCfg = {
        ...params.cfg,
        apps: { ...params.cfg.apps, [params.appName]: finalApp },
      }
      await this.services.config.write(params.configFile, finalCfg)
      cleanup.configWritten = true
      cleanup.finalEnvFile = finalApp.env_file
      this.services.onStateChange?.('config_written')

      for (const entry of guided.envEntries) {
        await this.services.secrets.upsert(params.appName, entry, finalApp.env_file)
        cleanup.writtenSecretKeys.push(entry.key)
      }
      this.services.onStateChange?.('secrets_written')

      await this.services.ingress.claim(params.appName, finalApp)
      this.services.onStateChange?.('routes_claimed')

      return { finalApp, secretsWritten: guided.envEntries.length }
    } catch (error) {
      await cleanupFailedAdd(params, this.services, cleanup)
      throw normalizeAddError(error, params.appName, params.configFile)
    }
  }
}
