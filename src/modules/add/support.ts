import { rm } from 'node:fs/promises'
import { configLoad, configWrite } from '@jib/config'
import type { App, Config } from '@jib/config'
import { type Paths, managedComposePath } from '@jib/paths'
import { type SecretsContext, secretsRemove, secretsUpsert } from '@jib/secrets'
import { sourcesCloneForInspection, sourcesRemoveCheckout } from '@jib/sources'
import type { AddSupport, EnvEntry } from './types.ts'

export interface AddDefaultSupportOptions {
  paths: Paths
  claimIngress(appName: string, appCfg: App): Promise<void>
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
      if (result instanceof Error) throw result
      return result
    },
    removeCheckout(appName: string, repo: string) {
      return sourcesRemoveCheckout(options.paths, appName, repo)
    },
    loadConfig(configFile: string) {
      return configLoad(configFile).then((result) => {
        if (result instanceof Error) throw result
        return result
      })
    },
    writeConfig(configFile: string, cfg: Config) {
      return configWrite(configFile, cfg).then((result) => {
        if (result instanceof Error) throw result
      })
    },
    async upsertSecret(appName: string, entry: EnvEntry, envFile: string) {
      const error = await secretsUpsert(secrets, appName, entry.key, entry.value, envFile)
      if (error) throw error
    },
    async removeSecret(appName: string, key: string, envFile: string) {
      const result = await secretsRemove(secrets, appName, key, envFile)
      if (result instanceof Error) throw result
    },
    removeManagedCompose(appName: string) {
      return rm(managedComposePath(options.paths, appName), { force: true })
    },
    claimIngress(appName: string, finalApp: App) {
      return options.claimIngress(appName, finalApp)
    },
  }
}
