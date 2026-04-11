import { hasTunnelToken } from '@jib-module/cloudflared'
import { type Config, writeConfig } from '@jib/config'
import type { Paths } from '@jib/core'

interface ReconcileDeps {
  writeConfig?: typeof writeConfig
}

export function inferredOptionalModules(config: Config, paths: Paths): Record<string, true> {
  const inferred: Record<string, true> = {}

  if (config.modules.cloudflared === undefined && hasTunnelToken(paths)) {
    inferred.cloudflared = true
  }

  return inferred
}

export async function reconcileOptionalModules(
  config: Config,
  paths: Paths,
  deps: ReconcileDeps = {},
): Promise<Config> {
  const inferred = inferredOptionalModules(config, paths)
  if (Object.keys(inferred).length === 0) return config

  const next: Config = {
    ...config,
    modules: {
      ...config.modules,
      ...inferred,
    },
  }
  await (deps.writeConfig ?? writeConfig)(paths.configFile, next)
  return next
}
