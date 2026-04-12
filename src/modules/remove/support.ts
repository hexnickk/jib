import { rm } from 'node:fs/promises'
import { writeConfig } from '@jib/config'
import type { Config } from '@jib/config'
import { composeFor, overridePath } from '@jib/docker'
import { type Paths, managedComposePath } from '@jib/paths'
import { SecretsManager } from '@jib/secrets'
import { removeCheckout } from '@jib/sources'
import { Store } from '@jib/state'
import type { RemoveSupport } from './types.ts'

export interface DefaultRemoveSupportOptions {
  paths: Paths
  releaseIngress(appName: string): Promise<void>
}

export class DefaultRemoveSupport implements RemoveSupport {
  private readonly secrets: SecretsManager
  private readonly store: Store

  constructor(private readonly options: DefaultRemoveSupportOptions) {
    this.secrets = new SecretsManager(options.paths.secretsDir)
    this.store = new Store(options.paths.stateDir)
  }

  releaseIngress(appName: string) {
    return this.options.releaseIngress(appName)
  }

  async stopApp(cfg: Config, appName: string, quiet: boolean) {
    const compose = composeFor(cfg, this.options.paths, appName)
    await compose.down(false, { quiet })
  }

  removeCheckout(appName: string, repo: string) {
    return removeCheckout(this.options.paths, appName, repo)
  }

  removeSecrets(appName: string) {
    return this.secrets.removeApp(appName)
  }

  removeState(appName: string) {
    return this.store.remove(appName)
  }

  removeOverride(appName: string) {
    return rm(overridePath(this.options.paths.overridesDir, appName), { force: true })
  }

  removeManagedCompose(appName: string) {
    return rm(managedComposePath(this.options.paths, appName), { force: true })
  }

  writeConfig(configFile: string, cfg: Config) {
    return writeConfig(configFile, cfg)
  }
}
