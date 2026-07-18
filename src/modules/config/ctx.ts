import { type InternalError, NotFoundError, type ValidationError } from '@jib/errors'
import type { Paths } from '@jib/paths'
import { pathsGetPaths } from '@jib/paths'
import { configLoad } from './load.ts'
import type { Config } from './schema.ts'

/**
 * Shared config loader for every CLI command. Collapses the "read paths ->
 * config load" boilerplate and leaves error rendering to the command boundary.
 */
export async function configLoadContext(): Promise<
  { cfg: Config; paths: Paths } | InternalError | ValidationError
> {
  const paths = pathsGetPaths()
  const cfg = await configLoad(paths.configFile)
  if (cfg instanceof Error) {
    return cfg
  }
  return { cfg, paths }
}

/** Load config and assert that `app` exists. */
export async function configLoadAppContext(
  app: string,
): Promise<{ cfg: Config; paths: Paths } | InternalError | ValidationError | NotFoundError> {
  const loaded = await configLoadContext()
  if (loaded instanceof Error) {
    return loaded
  }
  if (!loaded.cfg.apps[app]) {
    return new NotFoundError(`app "${app}" not found in config`)
  }
  return loaded
}
