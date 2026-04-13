import { rm } from 'node:fs/promises'
import { configWrite } from '@jib/config'
import type { Config } from '@jib/config'
import { DockerAppNotFoundError, dockerComposeFor, dockerOverridePath } from '@jib/docker'
import { type Paths, managedComposePath } from '@jib/paths'
import { createSecretsManager } from '@jib/secrets'
import { sourcesRemoveCheckout } from '@jib/sources'
import { stateCreateStore, stateRemove } from '@jib/state'
import { RemoveWriteConfigError } from './errors.ts'
import type { RemoveSupport } from './types.ts'

export interface RemoveSupportOptions {
  paths: Paths
  releaseIngress(appName: string): Promise<void>
}

/** Creates the default remove support implementation backed by app modules. */
export function removeCreateSupport(options: RemoveSupportOptions): RemoveSupport {
  const secrets = createSecretsManager(options.paths.secretsDir)
  const store = stateCreateStore(options.paths.stateDir)

  return {
    releaseIngress(appName: string) {
      return options.releaseIngress(appName)
    },

    async stopApp(cfg: Config, appName: string, quiet: boolean) {
      const compose = dockerComposeFor(cfg, options.paths, appName)
      if (compose instanceof DockerAppNotFoundError) return
      await compose.down(false, { quiet })
    },

    removeCheckout(appName: string, repo: string) {
      return sourcesRemoveCheckout(options.paths, appName, repo)
    },

    removeSecrets(appName: string) {
      return secrets.removeApp(appName)
    },

    removeState(appName: string) {
      return stateRemove(store, appName).then((error) => {
        if (error) throw error
      })
    },

    removeOverride(appName: string) {
      return rm(dockerOverridePath(options.paths.overridesDir, appName), { force: true })
    },

    removeManagedCompose(appName: string) {
      return rm(managedComposePath(options.paths, appName), { force: true })
    },

    async writeConfig(configFile: string, cfg: Config) {
      const result = await configWrite(configFile, cfg)
      if (!result) return undefined
      return new RemoveWriteConfigError(configFile, { cause: result })
    },
  }
}
