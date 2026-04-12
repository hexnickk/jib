import type { Paths } from '@jib/paths'
import { getPaths } from '@jib/paths'
import { ConfigError, MissingConfigAppError } from './errors.ts'
import { loadConfigResult } from './load.ts'
import type { Config } from './schema.ts'

/**
 * Shared config loader for every CLI command. Collapses the "read paths ->
 * loadConfig boilerplate and leaves error rendering to the command boundary.
 */
export async function loadAppConfigResult(): Promise<{ cfg: Config; paths: Paths } | ConfigError> {
  const paths = getPaths()
  const cfg = await loadConfigResult(paths.configFile)
  if (cfg instanceof ConfigError) return cfg
  return { cfg, paths }
}

export async function loadAppConfig(): Promise<{ cfg: Config; paths: Paths }> {
  const loaded = await loadAppConfigResult()
  if (loaded instanceof ConfigError) throw loaded
  return loaded
}

/** Load config and assert that `app` exists. */
export async function loadAppOrExitResult(
  app: string,
): Promise<{ cfg: Config; paths: Paths } | ConfigError | MissingConfigAppError> {
  const loaded = await loadAppConfigResult()
  if (loaded instanceof ConfigError) return loaded
  if (!loaded.cfg.apps[app]) {
    return new MissingConfigAppError(`app "${app}" not found in config`)
  }
  return loaded
}

/** Load config and assert that `app` exists. */
export async function loadAppOrExit(app: string): Promise<{ cfg: Config; paths: Paths }> {
  const loaded = await loadAppOrExitResult(app)
  if (loaded instanceof ConfigError || loaded instanceof MissingConfigAppError) throw loaded
  return loaded
}
