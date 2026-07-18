import type { Config } from '@jib/config'
import type { JibError } from '@jib/errors'

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
  releaseIngress(appName: string): Promise<JibError | undefined>
  stopApp(cfg: Config, appName: string, quiet: boolean): Promise<JibError | undefined>
  removeCheckout(appName: string, repo: string): Promise<JibError | undefined>
  removeSecrets(appName: string): Promise<JibError | undefined>
  removeState(appName: string): Promise<JibError | undefined>
  removeOverride(appName: string): Promise<JibError | undefined>
  removeManagedCompose(appName: string): Promise<JibError | undefined>
  writeConfig(configFile: string, cfg: Config): Promise<JibError | undefined>
}
