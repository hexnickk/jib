import { rm } from 'node:fs/promises'
import { configLoad, configWrite } from '@jib/config'
import type { App, Config } from '@jib/config'
import { type Paths, managedComposePath } from '@jib/paths'
import { createSecretsManager } from '@jib/secrets'
import { sourcesCloneForInspection, sourcesRemoveCheckout } from '@jib/sources'
import type { AddSupport, EnvEntry } from './types.ts'

export interface AddDefaultSupportOptions {
  paths: Paths
  claimIngress(appName: string, appCfg: App): Promise<void>
}

export function addCreateDefaultSupport(options: AddDefaultSupportOptions): AddSupport {
  const secrets = createSecretsManager(options.paths.secretsDir)

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
    upsertSecret(appName: string, entry: EnvEntry, envFile: string) {
      return secrets.upsert(appName, entry.key, entry.value, envFile)
    },
    async removeSecret(appName: string, key: string, envFile: string) {
      await secrets.remove(appName, key, envFile)
    },
    removeManagedCompose(appName: string) {
      return rm(managedComposePath(options.paths, appName), { force: true })
    },
    claimIngress(appName: string, finalApp: App) {
      return options.claimIngress(appName, finalApp)
    },
  }
}
