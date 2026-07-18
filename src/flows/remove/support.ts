import { rm } from 'node:fs/promises'
import { type Config, configWrite } from '@jib/config'
import { dockerComposeFor, dockerOverridePath } from '@jib/docker'
import { type JibError, errorsToJibError } from '@jib/errors'
import { type Paths, pathsManagedComposePath } from '@jib/paths'
import { type SecretsContext, secretsRemoveApp } from '@jib/secrets'
import { sourcesRemoveCheckout } from '@jib/sources'
import { stateCreateStore, stateRemove } from '@jib/state'
import type { RemoveSupport } from './types.ts'

export interface RemoveSupportOptions {
  paths: Paths
  releaseIngress(appName: string): Promise<JibError | undefined>
}

/** Creates the default remove support implementation backed by app modules. */
export function removeCreateSupport(options: RemoveSupportOptions): RemoveSupport {
  const secrets: SecretsContext = { secretsDir: options.paths.secretsDir }
  const store = stateCreateStore(options.paths.stateDir)

  return {
    releaseIngress(appName) {
      return runRemoveSupportStep(() => options.releaseIngress(appName))
    },
    async stopApp(cfg: Config, appName: string, quiet: boolean) {
      const compose = dockerComposeFor(cfg, options.paths, appName)
      if (compose instanceof Error) {
        return compose
      }
      return await runRemoveSupportStep(async () => {
        return await compose.down(false, { quiet })
      })
    },
    removeCheckout(appName, repo) {
      return runRemoveSupportStep(async () => {
        return await sourcesRemoveCheckout(options.paths, appName, repo)
      })
    },
    async removeSecrets(appName) {
      return await secretsRemoveApp(secrets, appName)
    },
    async removeState(appName) {
      return await stateRemove(store, appName)
    },
    removeOverride(appName) {
      return runRemoveSupportStep(async () => {
        await rm(dockerOverridePath(options.paths.overridesDir, appName), { force: true })
        return undefined
      })
    },
    removeManagedCompose(appName) {
      return runRemoveSupportStep(async () => {
        await rm(pathsManagedComposePath(options.paths, appName), { force: true })
        return undefined
      })
    },
    async writeConfig(configFile, cfg) {
      return await configWrite(configFile, cfg)
    },
  }
}

/** Executes one cleanup boundary and converts unexpected library throws to a shared error. */
async function runRemoveSupportStep(
  step: () => Promise<JibError | undefined>,
): Promise<JibError | undefined> {
  try {
    return await step()
  } catch (error) {
    return errorsToJibError(error)
  }
}
