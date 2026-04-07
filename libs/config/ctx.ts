import { type Config, loadConfig } from '@jib/config'
import { type Paths, getPaths } from '@jib/core'
import { consola } from 'consola'

/**
 * Shared config loader for every CLI command. Collapses the "read paths →
 * loadConfig → bail on error" boilerplate and — crucially — converts
 * file-not-found / validation errors into a clean `consola.error + exit 1`
 * rather than a stack trace. citty's own error handler prints stack traces,
 * so commands must catch these themselves.
 */
export async function loadAppConfig(): Promise<{ cfg: Config; paths: Paths }> {
  const paths = getPaths()
  try {
    const cfg = await loadConfig(paths.configFile)
    return { cfg, paths }
  } catch (err) {
    consola.error(err instanceof Error ? err.message : String(err))
    process.exit(1)
  }
}

/** Load config and assert that `app` exists; exit cleanly on miss. */
export async function loadAppOrExit(app: string): Promise<{ cfg: Config; paths: Paths }> {
  const { cfg, paths } = await loadAppConfig()
  if (!cfg.apps[app]) {
    consola.error(`app "${app}" not found in config`)
    process.exit(1)
  }
  return { cfg, paths }
}
