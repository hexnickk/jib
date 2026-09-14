import { cloudflaredHasTunnelToken } from '@jib-module/cloudflared'
import { type Config, configWrite } from '@jib/config'
import type { JibError } from '@jib/errors'
import type { Paths } from '@jib/paths'

/** Reconciles inferred flags; check mode returns the same result without persisting it. */
export async function initReconcileOptionalModules(
  config: Config,
  paths: Paths,
  options: { check?: boolean } = {},
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
  if (!options.check) {
    const writeResult = await configWrite(paths.configFile, next)
    if (writeResult instanceof Error) {
      return writeResult
    }
  }
  return next
}
