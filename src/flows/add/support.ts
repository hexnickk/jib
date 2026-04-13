import { rm } from 'node:fs/promises'
import { configLoad, configWrite } from '@jib/config'
import type { App, Config } from '@jib/config'
import { type Paths, pathsManagedComposePath } from '@jib/paths'
import { type SecretsContext, secretsRemove, secretsUpsert } from '@jib/secrets'
import { sourcesCloneForInspection, sourcesRemoveCheckout } from '@jib/sources'
import type { AddSupport, EnvEntry } from './types.ts'

export interface AddDefaultSupportOptions {
  paths: Paths
  claimIngress(appName: string, appCfg: App): Promise<undefined | Error>
}

export function addCreateDefaultSupport(options: AddDefaultSupportOptions): AddSupport {
  const secrets: SecretsContext = { secretsDir: options.paths.secretsDir }

  return {
    async cloneForInspection(
      cfg: Config,
      appName: string,
      target: { repo: string; branch: string; source?: string },
    ) {
      const result = await sourcesCloneForInspection(cfg, options.paths, {
        app: appName,
        ...target,
      })
      return result
    },
    removeCheckout(appName: string, repo: string) {
      return addRunSupportStep(async () => {
        await sourcesRemoveCheckout(options.paths, appName, repo)
        return undefined
      })
    },
    loadConfig(configFile: string) {
      return configLoad(configFile)
    },
    async writeConfig(configFile: string, cfg: Config) {
      return await configWrite(configFile, cfg)
    },
    async upsertSecret(appName: string, entry: EnvEntry, envFile: string) {
      return await secretsUpsert(secrets, appName, entry.key, entry.value, envFile)
    },
    async removeSecret(appName: string, key: string, envFile: string) {
      const result = await secretsRemove(secrets, appName, key, envFile)
      return result instanceof Error ? result : undefined
    },
    removeManagedCompose(appName: string) {
      return addRunSupportStep(async () => {
        await rm(pathsManagedComposePath(options.paths, appName), { force: true })
        return undefined
      })
    },
    claimIngress(appName: string, finalApp: App) {
      return addRunSupportStep(() => options.claimIngress(appName, finalApp))
    },
  }
}

/** Converts one add support side effect into a result-style operation. */
async function addRunSupportStep(
  step: () => Promise<undefined | Error>,
): Promise<undefined | Error> {
  try {
    const result = await step()
    return result instanceof Error ? result : undefined
  } catch (error) {
    return error instanceof Error ? error : new Error(String(error))
  }
}
