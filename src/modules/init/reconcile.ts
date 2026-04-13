import { cloudflaredHasTunnelToken } from '@jib-module/cloudflared'
import { type Config, configWrite } from '@jib/config'
import type { Paths } from '@jib/paths'

interface ReconcileDeps {
  writeConfig?: (configFile: string, config: Config) => Promise<undefined | Error>
}

export function initInferredOptionalModules(config: Config, paths: Paths): Record<string, true> {
  const inferred: Record<string, true> = {}

  if (config.modules.cloudflared === undefined && cloudflaredHasTunnelToken(paths)) {
    inferred.cloudflared = true
  }

  return inferred
}

export async function initReconcileOptionalModules(
  config: Config,
  paths: Paths,
  deps: ReconcileDeps = {},
): Promise<Config | Error> {
  const inferred = initInferredOptionalModules(config, paths)
  if (Object.keys(inferred).length === 0) return config

  const next: Config = {
    ...config,
    modules: {
      ...config.modules,
      ...inferred,
    },
  }
  const writeResult = await (deps.writeConfig ?? configWrite)(paths.configFile, next)
  if (writeResult instanceof Error) return writeResult
  return next
}
