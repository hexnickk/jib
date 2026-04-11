import type { Config } from '@jib/config'

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
  releaseIngress(appName: string): Promise<void>
  stopApp(cfg: Config, appName: string, quiet: boolean): Promise<void>
  removeCheckout(appName: string, repo: string): Promise<void>
  removeSecrets(appName: string): Promise<void>
  removeState(appName: string): Promise<void>
  removeOverride(appName: string): Promise<void>
  writeConfig(configFile: string, cfg: Config): Promise<void>
}
