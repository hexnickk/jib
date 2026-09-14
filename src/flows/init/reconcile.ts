import { cloudflaredHasTunnelToken } from '@jib-module/cloudflared'
import { type Config, configWrite } from '@jib/config'
import type { JibError } from '@jib/errors'
import type { Paths } from '@jib/paths'

/** Persists inferred optional-module flags and returns the updated config or a typed error. */
export async function initReconcileOptionalModules(
  config: Config,
  paths: Paths,
  writeConfig: (configFile: string, config: Config) => Promise<JibError | undefined> = configWrite,
): Promise<Config | JibError> {
  if (config.modules.cloudflared !== undefined || !cloudflaredHasTunnelToken(paths)) {
    return config
  }

  const next: Config = {
    ...config,
    modules: {
      ...config.modules,
      cloudflared: true,
    },
  }
  const writeResult = await writeConfig(paths.configFile, next)
  if (writeResult instanceof Error) {
    return writeResult
  }
  return next
}
