import { cloudflaredHasTunnelToken } from '@jib-module/cloudflared'
import { type Config, configWrite } from '@jib/config'
import type { JibError } from '@jib/errors'
import type { Paths } from '@jib/paths'

interface ReconcileDeps {
  writeConfig?: (configFile: string, config: Config) => Promise<JibError | undefined>
}

/** Infers enabled optional modules from durable resources created by older installs. */
export function initInferredOptionalModules(config: Config, paths: Paths): Record<string, true> {
  const inferred: Record<string, true> = {}

  if (config.modules.cloudflared === undefined && cloudflaredHasTunnelToken(paths)) {
    inferred.cloudflared = true
  }

  return inferred
}

/** Persists inferred optional-module flags and returns the updated config or a typed error. */
export async function initReconcileOptionalModules(
  config: Config,
  paths: Paths,
  deps: ReconcileDeps = {},
): Promise<Config | JibError> {
  const inferred = initInferredOptionalModules(config, paths)
  if (Object.keys(inferred).length === 0) {
    return config
  }

  const next: Config = {
    ...config,
    modules: {
      ...config.modules,
      ...inferred,
    },
  }
  const writeResult = await (deps.writeConfig ?? configWrite)(paths.configFile, next)
  if (writeResult instanceof Error) {
    return writeResult
  }
  return next
}
