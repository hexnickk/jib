import type { RemoveObserver, RemoveParams, RemoveResult, RemoveSupport } from './types.ts'

export class RemoveService {
  constructor(
    private readonly support: RemoveSupport,
    private readonly observer: RemoveObserver = {},
  ) {}

  async run(params: RemoveParams): Promise<RemoveResult> {
    const appCfg = params.cfg.apps[params.appName]
    if (!appCfg) {
      throw new Error(`app "${params.appName}" not found in config`)
    }

    if (appCfg.domains.length > 0) {
      await this.runBestEffort('ingress release', () => this.support.releaseIngress(params.appName))
    }

    await this.runBestEffort('compose down', () =>
      this.support.stopApp(params.cfg, params.appName, params.quiet),
    )
    await this.runBestEffort('repo cleanup', () =>
      this.support.removeCheckout(params.appName, appCfg.repo),
    )

    const nextApps = { ...params.cfg.apps }
    delete nextApps[params.appName]
    await this.support.writeConfig(params.configFile, { ...params.cfg, apps: nextApps })
    return { app: params.appName, removed: true }
  }

  private async runBestEffort(label: string, step: () => Promise<void>) {
    try {
      await step()
    } catch (error) {
      this.observer.warn?.(`${label}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
}
