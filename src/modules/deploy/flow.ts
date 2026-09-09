import type { App } from '@jib/config'
import {
  type DockerCompose,
  dockerAllHealthy,
  dockerCheckHealth,
  dockerComposeFor,
  dockerHasBuildServices,
} from '@jib/docker'
import { InternalError, type JibError, NotFoundError, errorsToJibError } from '@jib/errors'
import { pathsRepoPath } from '@jib/paths'
import { type AppState, stateLoad, stateSave } from '@jib/state'
import { deployLinkSecrets, deployReadDiskFree, deploySyncOverride } from './support.ts'
import type { DeployCmd, DeployDeps, DeployResult, ProgressCtx } from './types.ts'
import { MIN_DISK_BYTES } from './types.ts'

/** Executes the deploy steps after the app config has already been resolved. */
export async function deployRunFlow(
  deps: DeployDeps,
  cmd: DeployCmd,
  appCfg: App,
  progress: ProgressCtx,
): Promise<JibError | DeployResult> {
  const start = Date.now()

  progress.emit('disk', 'checking disk space')
  const free = await deployReadDiskFree(cmd.workdir)
  if (free instanceof Error) {
    return free
  }
  if (free < MIN_DISK_BYTES) {
    return new InternalError(`insufficient disk space: ${free} bytes free`)
  }

  const prevState = await stateLoad(deps.store, cmd.app)
  if (prevState instanceof Error) {
    return prevState
  }

  const overrideError = await deploySyncOverride(deps, cmd.app, appCfg, cmd.workdir)
  if (overrideError) {
    return overrideError
  }

  const secretsError = await deployLinkSecrets(deps, cmd.app, cmd.workdir)
  if (secretsError) {
    return secretsError
  }

  try {
    const compose = dockerComposeFor(deps.config, deps.paths, cmd.app, {
      workdir: cmd.workdir,
    })
    if (compose instanceof Error) {
      return compose
    }
    if (dockerHasBuildServices(cmd.workdir, appCfg.compose ?? [])) {
      progress.emit('build', `building ${cmd.app}`)
      const buildError = await compose.build()
      if (buildError) {
        return buildError
      }
    }

    for (const hook of appCfg.pre_deploy ?? []) {
      progress.emit('pre_deploy', `running ${hook.service}`)
      const hookError = await compose.run(hook.service, [])
      if (hookError) {
        return hookError
      }
    }

    progress.emit('up', 'starting containers')
    const upError = await compose.up({ services: appCfg.services ?? [] })
    if (upError) {
      return upError
    }

    if (appCfg.health && appCfg.health.length > 0) {
      progress.emit('health', 'running health checks')
      const results = await dockerCheckHealth(appCfg.health)
      if (!dockerAllHealthy(results)) {
        return new InternalError(`health check failed: ${JSON.stringify(results)}`)
      }
    }

    const next: AppState = {
      ...prevState,
      app: cmd.app,
      deployed_sha: cmd.sha,
      deployed_workdir: cmd.workdir,
      last_deploy: new Date().toISOString(),
      last_deploy_status: 'success',
      last_deploy_error: '',
    }
    const saveError = await stateSave(deps.store, cmd.app, next)
    if (saveError) {
      return saveError
    }
    return { deployedSHA: cmd.sha, durationMs: Date.now() - start }
  } catch (error) {
    return errorsToJibError(error)
  }
}

/** Resolves one configured app into a compose runner with overrides and secrets applied. */
export async function deployResolveAppCompose(
  deps: DeployDeps,
  appName: string,
): Promise<JibError | { appCfg: App; compose: DockerCompose }> {
  const appCfg = deps.config.apps[appName]
  if (!appCfg) {
    return new NotFoundError(`app "${appName}" not found in config`)
  }
  const workdir = pathsRepoPath(deps.paths, appName, appCfg.repo)
  const overrideError = await deploySyncOverride(deps, appName, appCfg, workdir)
  if (overrideError) {
    return overrideError
  }
  const secretsError = await deployLinkSecrets(deps, appName, workdir)
  if (secretsError) {
    return secretsError
  }
  const compose = dockerComposeFor(deps.config, deps.paths, appName, { workdir })
  if (compose instanceof Error) {
    return compose
  }
  return { appCfg, compose }
}
