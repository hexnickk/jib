import type { Config } from '@jib/config'
import type { RemoveWriteConfigError } from './errors.ts'

export interface RemoveParams {
  appName: string
  cfg: Config
  configFile: string
  quiet: boolean
}

export interface RemoveResult {
  app: string
  removed: true
}

export interface RemoveObserver {
  warn?(message: string): void
}

export interface RemoveSupport {
  releaseIngress(appName: string): Promise<undefined | Error>
  stopApp(cfg: Config, appName: string, quiet: boolean): Promise<undefined | Error>
  removeCheckout(appName: string, repo: string): Promise<undefined | Error>
  removeSecrets(appName: string): Promise<undefined | Error>
  removeState(appName: string): Promise<undefined | Error>
  removeOverride(appName: string): Promise<undefined | Error>
  removeManagedCompose(appName: string): Promise<undefined | Error>
  writeConfig(configFile: string, cfg: Config): Promise<RemoveWriteConfigError | undefined>
}
