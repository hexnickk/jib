import { type Config, loadConfig } from '@jib/config'
import { ValidationError } from '@jib/errors'
import { type Paths, getPaths } from '@jib/paths'

/**
 * Shared config loader for every CLI command. Collapses the "read paths →
 * loadConfig boilerplate and leaves error rendering to the command boundary.
 */
export async function loadAppConfig(): Promise<{ cfg: Config; paths: Paths }> {
  const paths = getPaths()
  const cfg = await loadConfig(paths.configFile)
  return { cfg, paths }
}

/** Load config and assert that `app` exists. */
export async function loadAppOrExit(app: string): Promise<{ cfg: Config; paths: Paths }> {
  const { cfg, paths } = await loadAppConfig()
  if (!cfg.apps[app]) {
    throw new ValidationError(`app "${app}" not found in config`)
  }
  return { cfg, paths }
}
