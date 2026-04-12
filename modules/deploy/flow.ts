import type { App } from '@jib/config'
import { allHealthy, checkHealth, hasBuildServices } from '@jib/docker'
import type { AppState } from '@jib/state'
import { repoPath } from '../paths/paths.ts'
import { DeployDiskSpaceError, DeployHealthCheckError, DeployMissingAppError } from './errors.ts'
import {
  coerceDeployError,
  linkSecrets,
  newCompose,
  readDiskFree,
  readState,
  syncOverride,
  writeState,
} from './support.ts'
import {
  type DeployCmd,
  type DeployError,
  type DeployResult,
  type EngineDeps,
  MIN_DISK_BYTES,
  type ProgressCtx,
} from './types.ts'

export async function runDeployFlow(
  deps: EngineDeps,
  cmd: DeployCmd,
  appCfg: App,
  progress: ProgressCtx,
): Promise<DeployError | DeployResult> {
  const start = Date.now()

  progress.emit('disk', 'checking disk space')
  const free = await readDiskFree(deps, cmd.workdir)
  if (free instanceof Error) return free
  if (free < MIN_DISK_BYTES) return new DeployDiskSpaceError(free)

  const prevState = await readState(deps.store, cmd.app)
  if (prevState instanceof Error) return prevState

  const overrideError = await syncOverride(deps, cmd.app, appCfg, cmd.workdir)
  if (overrideError) return overrideError

  const secretsError = await linkSecrets(deps, cmd.app, appCfg, cmd.workdir)
  if (secretsError) return secretsError

  try {
    const compose = newCompose(deps, cmd.app, appCfg, cmd.workdir)
    const buildArgs = appCfg.build_args ?? {}
    if (hasBuildServices(cmd.workdir, appCfg.compose ?? [])) {
      progress.emit('build', `building ${cmd.app}`)
      await compose.build(buildArgs)
    }

    for (const hook of appCfg.pre_deploy ?? []) {
      progress.emit('pre_deploy', `running ${hook.service}`)
      await compose.run(hook.service, [])
    }

    progress.emit('up', 'starting containers')
    await compose.up({ services: appCfg.services ?? [], buildArgs })

    if (appCfg.health && appCfg.health.length > 0) {
      progress.emit('health', 'running health checks')
      const results = await checkHealth(appCfg.health, deps.healthOpts ?? {})
      if (!allHealthy(results)) {
        return new DeployHealthCheckError(`health check failed: ${JSON.stringify(results)}`)
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
    const saveError = await writeState(deps.store, cmd.app, next)
    if (saveError) return saveError
    return { deployedSHA: cmd.sha, durationMs: Date.now() - start }
  } catch (error) {
    return coerceDeployError(error)
  }
}

export async function resolveAppCompose(
  deps: EngineDeps,
  appName: string,
): Promise<DeployError | { appCfg: App; compose: ReturnType<typeof newCompose> }> {
  const appCfg = deps.config.apps[appName]
  if (!appCfg) return new DeployMissingAppError(appName)
  const workdir = repoPath(deps.paths, appName, appCfg.repo)
  const overrideError = await syncOverride(deps, appName, appCfg, workdir)
  if (overrideError) return overrideError
  const secretsError = await linkSecrets(deps, appName, appCfg, workdir)
  if (secretsError) return secretsError
  return { appCfg, compose: newCompose(deps, appName, appCfg, workdir) }
}
