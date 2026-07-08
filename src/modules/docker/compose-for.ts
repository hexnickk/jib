import { existsSync } from 'node:fs'
import { join } from 'node:path'
import type { Config } from '@jib/config'
import { type Paths, pathsRepoPath } from '@jib/paths'
import { type ComposeConfig, type DockerCompose, dockerCreateCompose } from './compose.ts'
import { DockerAppNotFoundError } from './errors.ts'
import { dockerOverridePath } from './override.ts'

/**
 * Build a docker-compose handle for `app` from loaded config + resolved
 * paths. Mirrors the Go `newCompose` helper: resolves the app's workdir,
 * stitches together declared compose files, and points at jib's managed
 * override file.
 *
 * `--env-file` is only set if the managed secrets file exists on disk —
 * docker compose errors out when pointed at a missing file, and most apps
 * don't need secrets.
 */
export function dockerComposeFor(
  cfg: Config,
  paths: Paths,
  app: string,
): DockerCompose | DockerAppNotFoundError {
  const appCfg = cfg.apps[app]
  if (!appCfg) return new DockerAppNotFoundError(app)

  const dir = pathsRepoPath(paths, app, appCfg.repo)
  const files = (
    appCfg.compose && appCfg.compose.length > 0 ? appCfg.compose : ['docker-compose.yml']
  ).map((f) => (f.startsWith('/') ? f : join(dir, f)))

  const envFileCandidate = join(paths.secretsDir, app, '.env')
  const envFile = existsSync(envFileCandidate) ? envFileCandidate : undefined

  const config: ComposeConfig = {
    app,
    dir,
    files,
    override: dockerOverridePath(paths.overridesDir, app),
  }
  if (envFile) config.envFile = envFile
  return dockerCreateCompose(config)
}
