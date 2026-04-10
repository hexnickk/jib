import { writeConfig } from '@jib/config'
import type { Config } from '@jib/config'
import type { Paths } from '@jib/core'
import { composeFor } from '@jib/docker'
import { removeCheckout } from '@jib/sources'
import type { RemoveSupport } from './types.ts'

export interface DefaultRemoveSupportOptions {
  paths: Paths
  releaseIngress(appName: string): Promise<void>
}

export class DefaultRemoveSupport implements RemoveSupport {
  constructor(private readonly options: DefaultRemoveSupportOptions) {}

  releaseIngress(appName: string) {
    return this.options.releaseIngress(appName)
  }

  async stopApp(cfg: Config, appName: string, quiet: boolean) {
    const compose = composeFor(cfg, this.options.paths, appName)
    await compose.down(false, { quiet })
  }

  removeCheckout(appName: string, repo: string) {
    return removeCheckout(this.options.paths, appName, repo)
  }

  writeConfig(configFile: string, cfg: Config) {
    return writeConfig(configFile, cfg)
  }
}
