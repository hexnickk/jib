import { rm } from 'node:fs/promises'
import { configWrite } from '@jib/config'
import type { Config } from '@jib/config'
import { composeFor, overridePath } from '@jib/docker'
import { type Paths, managedComposePath } from '@jib/paths'
import { SecretsManager } from '@jib/secrets'
import { sourcesRemoveCheckout } from '@jib/sources'
import { Store } from '@jib/state'
import { RemoveWriteConfigError } from './errors.ts'
import type { RemoveSupport } from './types.ts'

export interface DefaultRemoveSupportOptions {
  paths: Paths
  releaseIngress(appName: string): Promise<void>
}

export function createRemoveSupport(options: DefaultRemoveSupportOptions): RemoveSupport {
  const secrets = new SecretsManager(options.paths.secretsDir)
  const store = new Store(options.paths.stateDir)

  return {
    releaseIngress(appName: string) {
      return options.releaseIngress(appName)
    },

    async stopApp(cfg: Config, appName: string, quiet: boolean) {
      const compose = composeFor(cfg, options.paths, appName)
      await compose.down(false, { quiet })
    },

    removeCheckout(appName: string, repo: string) {
      return sourcesRemoveCheckout(options.paths, appName, repo)
    },

    removeSecrets(appName: string) {
      return secrets.removeApp(appName)
    },

    removeState(appName: string) {
      return store.remove(appName)
    },

    removeOverride(appName: string) {
      return rm(overridePath(options.paths.overridesDir, appName), { force: true })
    },

    removeManagedCompose(appName: string) {
      return rm(managedComposePath(options.paths, appName), { force: true })
    },

    async writeConfig(configFile: string, cfg: Config) {
      const result = await configWrite(configFile, cfg)
      if (!result) return undefined
      if (result instanceof RemoveWriteConfigError) return result
      return new RemoveWriteConfigError(configFile, { cause: result })
    },
  }
}

export class DefaultRemoveSupport implements RemoveSupport {
  private readonly support: RemoveSupport

  constructor(options: DefaultRemoveSupportOptions) {
    this.support = createRemoveSupport(options)
  }

  releaseIngress(appName: string) {
    return this.support.releaseIngress(appName)
  }

  stopApp(cfg: Config, appName: string, quiet: boolean) {
    return this.support.stopApp(cfg, appName, quiet)
  }

  removeCheckout(appName: string, repo: string) {
    return this.support.removeCheckout(appName, repo)
  }

  removeSecrets(appName: string) {
    return this.support.removeSecrets(appName)
  }

  removeState(appName: string) {
    return this.support.removeState(appName)
  }

  removeOverride(appName: string) {
    return this.support.removeOverride(appName)
  }

  removeManagedCompose(appName: string) {
    return this.support.removeManagedCompose(appName)
  }

  writeConfig(configFile: string, cfg: Config) {
    return this.support.writeConfig(configFile, cfg)
  }
}
