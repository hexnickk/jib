import { rm } from 'node:fs/promises'
import { configWrite } from '@jib/config'
import type { Config } from '@jib/config'
import { DockerAppNotFoundError, dockerComposeFor, dockerOverridePath } from '@jib/docker'
import { type Paths, pathsManagedComposePath } from '@jib/paths'
import { type SecretsContext, secretsRemoveApp } from '@jib/secrets'
import { sourcesRemoveCheckout } from '@jib/sources'
import { stateCreateStore, stateRemove } from '@jib/state'
import { RemoveWriteConfigError } from './errors.ts'
import type { RemoveSupport } from './types.ts'

export interface RemoveSupportOptions {
  paths: Paths
  releaseIngress(appName: string): Promise<undefined | Error>
}

/** Creates the default remove support implementation backed by app modules. */
export function removeCreateSupport(options: RemoveSupportOptions): RemoveSupport {
  const secrets: SecretsContext = { secretsDir: options.paths.secretsDir }
  const store = stateCreateStore(options.paths.stateDir)

  return {
    releaseIngress(appName: string) {
      return runRemoveSupportStep(() => options.releaseIngress(appName))
    },

    async stopApp(cfg: Config, appName: string, quiet: boolean) {
      const compose = dockerComposeFor(cfg, options.paths, appName)
      if (compose instanceof DockerAppNotFoundError) return
      return runRemoveSupportStep(async () => {
        await compose.down(false, { quiet })
        return undefined
      })
    },

    removeCheckout(appName: string, repo: string) {
      return runRemoveSupportStep(async () => {
        await sourcesRemoveCheckout(options.paths, appName, repo)
        return undefined
      })
    },

    removeSecrets(appName: string) {
      return secretsRemoveApp(secrets, appName)
    },

    removeState(appName: string) {
      return stateRemove(store, appName)
    },

    removeOverride(appName: string) {
      return runRemoveSupportStep(async () => {
        await rm(dockerOverridePath(options.paths.overridesDir, appName), { force: true })
        return undefined
      })
    },

    removeManagedCompose(appName: string) {
      return runRemoveSupportStep(async () => {
        await rm(pathsManagedComposePath(options.paths, appName), { force: true })
        return undefined
      })
    },

    async writeConfig(configFile: string, cfg: Config) {
      const result = await configWrite(configFile, cfg)
      if (!result) return undefined
      return new RemoveWriteConfigError(configFile, { cause: result })
    },
  }
}

/** Converts one cleanup helper into a result-style remove support operation. */
async function runRemoveSupportStep(
  step: () => Promise<undefined | Error>,
): Promise<undefined | Error> {
  try {
    const result = await step()
    return result instanceof Error ? result : undefined
  } catch (error) {
    return error instanceof Error ? error : new Error(String(error))
  }
}
