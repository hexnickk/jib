import { rm } from 'node:fs/promises'
import { type App, configLoad, configWrite } from '@jib/config'
import { type JibError, errorsToJibError } from '@jib/errors'
import { type Paths, pathsManagedComposePath } from '@jib/paths'
import { type SecretsContext, secretsRemove, secretsUpsert } from '@jib/secrets'
import { sourcesCloneForInspection, sourcesRemoveCheckout } from '@jib/sources'
import type { AddSupport, EnvEntry } from './types.ts'

export interface AddDefaultSupportOptions {
  paths: Paths
  claimIngress(appName: string, appCfg: App): Promise<undefined | JibError>
}

/** Creates the filesystem, config, source, and secret adapters used by the add flow. */
export function addCreateDefaultSupport(options: AddDefaultSupportOptions): AddSupport {
  const secrets: SecretsContext = { secretsDir: options.paths.secretsDir }

  return {
    async cloneForInspection(cfg, appName, target) {
      return await sourcesCloneForInspection(cfg, options.paths, { app: appName, ...target })
    },
    removeCheckout(appName, repo) {
      return addRunSupportStep(async () => {
        return await sourcesRemoveCheckout(options.paths, appName, repo)
      })
    },
    loadConfig(configFile) {
      return configLoad(configFile)
    },
    async writeConfig(configFile, cfg) {
      return await configWrite(configFile, cfg)
    },
    async upsertSecret(appName, entry: EnvEntry) {
      return await secretsUpsert(secrets, appName, entry.key, entry.value)
    },
    async removeSecret(appName, key) {
      const result = await secretsRemove(secrets, appName, key)
      return result instanceof Error ? result : undefined
    },
    removeManagedCompose(appName) {
      return addRunSupportStep(async () => {
        await rm(pathsManagedComposePath(options.paths, appName), { force: true })
        return undefined
      })
    },
    claimIngress(appName, finalApp) {
      return addRunSupportStep(() => options.claimIngress(appName, finalApp))
    },
  }
}

/** Executes one support boundary and converts unexpected library throws to a shared error. */
async function addRunSupportStep(
  step: () => Promise<undefined | JibError>,
): Promise<undefined | JibError> {
  try {
    return await step()
  } catch (error) {
    return errorsToJibError(error)
  }
}
