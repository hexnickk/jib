import { loadConfig, writeConfig } from '@jib/config'
import type { App, Config } from '@jib/config'
import type { Paths } from '@jib/paths'
import { SecretsManager } from '@jib/secrets'
import { cloneForInspection, removeCheckout } from '@jib/sources'
import type { AddSupport, EnvEntry } from './types.ts'

export interface DefaultAddSupportOptions {
  paths: Paths
  claimIngress(appName: string, appCfg: App): Promise<void>
}

export class DefaultAddSupport implements AddSupport {
  private readonly secrets: SecretsManager

  constructor(private readonly options: DefaultAddSupportOptions) {
    this.secrets = new SecretsManager(options.paths.secretsDir)
  }

  cloneForInspection(
    cfg: Config,
    appName: string,
    target: { repo: string; branch: string; source?: string },
  ) {
    return cloneForInspection(cfg, this.options.paths, { app: appName, ...target })
  }

  removeCheckout(appName: string, repo: string) {
    return removeCheckout(this.options.paths, appName, repo)
  }

  loadConfig(configFile: string) {
    return loadConfig(configFile)
  }

  writeConfig(configFile: string, cfg: Config) {
    return writeConfig(configFile, cfg)
  }

  upsertSecret(appName: string, entry: EnvEntry, envFile: string) {
    return this.secrets.upsert(appName, entry.key, entry.value, envFile)
  }

  async removeSecret(appName: string, key: string, envFile: string) {
    await this.secrets.remove(appName, key, envFile)
  }

  claimIngress(appName: string, finalApp: App) {
    return this.options.claimIngress(appName, finalApp)
  }
}
