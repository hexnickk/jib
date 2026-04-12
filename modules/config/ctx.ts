import type { Paths } from '@jib/paths'
import { getPaths } from '@jib/paths'
import { ConfigError, MissingConfigAppError } from './errors.ts'
import { configLoad } from './load.ts'
import type { Config } from './schema.ts'

/**
 * Shared config loader for every CLI command. Collapses the "read paths ->
 * config load" boilerplate and leaves error rendering to the command boundary.
 */
export async function configLoadContext(): Promise<{ cfg: Config; paths: Paths } | ConfigError> {
  const paths = getPaths()
  const cfg = await configLoad(paths.configFile)
  if (cfg instanceof ConfigError) return cfg
  return { cfg, paths }
}

/** Load config and assert that `app` exists. */
export async function configLoadAppContext(
  app: string,
): Promise<{ cfg: Config; paths: Paths } | ConfigError | MissingConfigAppError> {
  const loaded = await configLoadContext()
  if (loaded instanceof ConfigError) return loaded
  if (!loaded.cfg.apps[app]) {
    return new MissingConfigAppError(`app "${app}" not found in config`)
  }
  return loaded
}
