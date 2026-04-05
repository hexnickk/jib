import { existsSync } from 'node:fs'
import { join } from 'node:path'
import type { Config } from '@jib/config'
import { type Paths, repoPath } from '@jib/core'
import { Compose } from '@jib/docker'
import { overridePath } from '@jib/docker'

/**
 * Build a {@link Compose} handle for `app` from loaded config + resolved
 * paths. Mirrors the Go `newCompose` helper: resolves the app's workdir,
 * stitches together declared compose files, and points at jib's managed
 * override file. Throws when the app is unknown so every caller gets a
 * consistent error message.
 *
 * `--env-file` is only set if the secrets file actually exists on disk —
 * docker compose errors out when pointed at a missing file, and most apps
 * don't need secrets. `env_file: .env` at the app config level is the
 * default value of the schema, not a signal that secrets must exist.
 */
export function composeFor(cfg: Config, paths: Paths, app: string): Compose {
  const appCfg = cfg.apps[app]
  if (!appCfg) throw new Error(`app "${app}" not found in config`)

  const dir = repoPath(paths, app, appCfg.repo)
  const files = (
    appCfg.compose && appCfg.compose.length > 0 ? appCfg.compose : ['docker-compose.yml']
  ).map((f) => (f.startsWith('/') ? f : join(dir, f)))

  const envFileCandidate = appCfg.env_file ? join(paths.secretsDir, app, appCfg.env_file) : undefined
  const envFile = envFileCandidate && existsSync(envFileCandidate) ? envFileCandidate : undefined

  const config: ConstructorParameters<typeof Compose>[0] = {
    app,
    dir,
    files,
    override: overridePath(paths.overridesDir, app),
  }
  if (envFile) config.envFile = envFile
  return new Compose(config)
}
