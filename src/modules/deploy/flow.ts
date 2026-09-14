import type { App } from '@jib/config'
import {
  dockerAllHealthy,
  dockerCheckHealth,
  dockerComposeFor,
  dockerHasBuildServices,
} from '@jib/docker'
import { InternalError, type JibError, errorsToJibError } from '@jib/errors'
import { type AppState, stateLoad, stateSave } from '@jib/state'
import { deployLinkSecrets, deployReadDiskFree, deploySyncOverride } from './support.ts'
import type { DeployCmd, DeployDeps, DeployResult, DeployProgress } from './types.ts'
import { MIN_DISK_BYTES } from './types.ts'

/** Executes the deploy steps after the app config has already been resolved. */
export async function deployRunFlow(
  deps: DeployDeps,
  cmd: DeployCmd,
  appCfg: App,
  emit: DeployProgress,
): Promise<JibError | DeployResult> {
  const start = Date.now()

  emit('disk', 'checking disk space')
  const free = await deployReadDiskFree(cmd.workdir)
  if (free instanceof Error) {
    return free
  }
  if (free < MIN_DISK_BYTES) {
    return new InternalError(`insufficient disk space: ${free} bytes free`)
  }

  const prevState = await stateLoad(deps.stateDir, cmd.app)
  if (prevState instanceof Error) {
    return prevState
  }

  const overrideError = await deploySyncOverride(deps.paths, cmd.app, appCfg, cmd.workdir)
  if (overrideError) {
    return overrideError
  }

  const secretsError = await deployLinkSecrets(deps.paths, cmd.app, cmd.workdir)
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
      emit('build', `building ${cmd.app}`)
      const buildError = await compose.build()
      if (buildError) {
        return buildError
      }
    }

    for (const hook of appCfg.pre_deploy ?? []) {
      emit('pre_deploy', `running ${hook.service}`)
      const hookError = await compose.run(hook.service, [])
      if (hookError) {
        return hookError
      }
    }

    emit('up', 'starting containers')
    const upError = await compose.up({ services: appCfg.services ?? [] })
    if (upError) {
      return upError
    }

    if (appCfg.health && appCfg.health.length > 0) {
      emit('health', 'running health checks')
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
    const saveError = await stateSave(deps.stateDir, cmd.app, next)
    if (saveError) {
      return saveError
    }
    return { deployedSHA: cmd.sha, durationMs: Date.now() - start }
  } catch (error) {
    return errorsToJibError(error)
  }
}
