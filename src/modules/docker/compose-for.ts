import { existsSync } from 'node:fs'
import { join } from 'node:path'
import type { Config } from '@jib/config'
import { NotFoundError } from '@jib/errors'
import { type Paths, pathsRepoPath } from '@jib/paths'
import { type DockerCompose, dockerCreateCompose } from './compose.ts'
import type { DockerExec } from './exec.ts'
import { dockerOverridePath } from './override.ts'

/** Resolves one app's Compose files, workdir, override, and optional managed env file. */
export function dockerComposeFor(
  cfg: Config,
  paths: Paths,
  app: string,
  options: { workdir?: string; exec?: DockerExec } = {},
): DockerCompose | NotFoundError {
  const appCfg = cfg.apps[app]
  if (!appCfg) {
    return new NotFoundError(`app "${app}" not found in config`)
  }

  const dir = options.workdir ?? pathsRepoPath(paths, app, appCfg.repo)
  const files = (
    appCfg.compose && appCfg.compose.length > 0 ? appCfg.compose : ['docker-compose.yml']
  ).map((file) => (file.startsWith('/') ? file : join(dir, file)))
  const envFile = join(paths.secretsDir, app, '.env')

  return dockerCreateCompose({
    app,
    dir,
    files,
    override: dockerOverridePath(paths.overridesDir, app),
    ...(existsSync(envFile) ? { envFile } : {}),
    ...(options.exec ? { exec: options.exec } : {}),
  })
}
