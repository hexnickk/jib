import { InternalError, type JibError, NotFoundError, errorsToJibError } from '@jib/errors'
import { stateAcquireLock, stateRecordFailure } from '@jib/state'
import { deployResolveAppCompose, deployRunFlow } from './flow.ts'
import type { DeployCmd, DeployDeps, DeployResult, ProgressCtx } from './types.ts'

export { MIN_DISK_BYTES } from './types.ts'
export type { DeployCmd, DeployDeps, DeployResult, ProgressCtx } from './types.ts'

/** Runs the full deploy flow for one prepared app workdir and records deploy state updates. */
export async function deployApp(
  deps: DeployDeps,
  cmd: DeployCmd,
  progress: ProgressCtx,
): Promise<JibError | DeployResult> {
  const appCfg = deps.config.apps[cmd.app]
  if (!appCfg) {
    return new NotFoundError(`app "${cmd.app}" not found in config`)
  }

  progress.emit('lock', `acquiring lock for ${cmd.app}`)
  const release = await stateAcquireLock(deps.paths.locksDir, cmd.app, { blocking: false })
  if (release instanceof Error) {
    return new InternalError(`acquire lock for ${cmd.app}: ${release.message}`, { cause: release })
  }

  const result = await deployRunFlow(deps, cmd, appCfg, progress)
  if (result instanceof Error) {
    deps.log.error(`deploy ${cmd.app} failed: ${result.message}`)
    const recordFailureError = await stateRecordFailure(deps.store, cmd.app, result.message)
    if (recordFailureError) {
      deps.log.error(`deploy ${cmd.app} failure state update failed: ${recordFailureError.message}`)
    }
  }

  try {
    await release()
  } catch (error) {
    const cause = errorsToJibError(error)
    const releaseError = new InternalError(`release lock for ${cmd.app}: ${cause.message}`, {
      cause,
    })
    if (!(result instanceof Error)) {
      return releaseError
    }
    deps.log.error(`deploy ${cmd.app} lock release failed: ${releaseError.message}`)
  }
  return result
}

/** Starts existing containers for one configured app without rebuilding them. */
export async function deployUpApp(
  deps: DeployDeps,
  appName: string,
): Promise<JibError | undefined> {
  const ready = await deployResolveAppCompose(deps, appName)
  if (ready instanceof Error) {
    return ready
  }
  return ready.compose.up({ services: ready.appCfg.services ?? [] })
}

/** Stops one configured app and optionally removes volumes. */
export async function deployDownApp(
  deps: DeployDeps,
  appName: string,
  removeVolumes = false,
): Promise<JibError | undefined> {
  const ready = await deployResolveAppCompose(deps, appName)
  if (ready instanceof Error) {
    return ready
  }
  return ready.compose.down(removeVolumes)
}

/** Restarts containers for one configured app without changing the deployed SHA. */
export async function deployRestartApp(
  deps: DeployDeps,
  appName: string,
): Promise<JibError | undefined> {
  const ready = await deployResolveAppCompose(deps, appName)
  if (ready instanceof Error) {
    return ready
  }
  return ready.compose.restart()
}
