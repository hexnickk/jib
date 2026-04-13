import { DeployMissingAppError } from './errors.ts'
import { deployResolveAppCompose, deployRunFlow } from './flow.ts'
import {
  deployAcquireLock,
  deployRecordFailure,
  deployReleaseLock,
  deployRunOrReturnError,
} from './support.ts'
import type { DeployCmd, DeployDeps, DeployError, DeployResult, ProgressCtx } from './types.ts'

export { MIN_DISK_BYTES } from './types.ts'
export type { DeployCmd, DeployDeps, DeployError, DeployResult, ProgressCtx } from './types.ts'

/** Runs the full deploy flow for one prepared app workdir and records deploy state updates. */
export async function deployApp(
  deps: DeployDeps,
  cmd: DeployCmd,
  progress: ProgressCtx,
): Promise<DeployError | DeployResult> {
  const appCfg = deps.config.apps[cmd.app]
  if (!appCfg) return new DeployMissingAppError(cmd.app)

  progress.emit('lock', `acquiring lock for ${cmd.app}`)
  const release = await deployAcquireLock(deps, cmd.app)
  if (release instanceof Error) return release

  const result = await deployRunFlow(deps, cmd, appCfg, progress)
  if (result instanceof Error) {
    deps.log.error(`deploy ${cmd.app} failed: ${result.message}`)
    const recordFailureError = await deployRecordFailure(deps, cmd.app, result.message)
    if (recordFailureError) {
      deps.log.error(`deploy ${cmd.app} failure state update failed: ${recordFailureError.message}`)
    }
  }

  const releaseError = await deployReleaseLock(cmd.app, release)
  if (releaseError) {
    if (!(result instanceof Error)) return releaseError
    deps.log.error(`deploy ${cmd.app} lock release failed: ${releaseError.message}`)
  }
  return result
}

/** Starts existing containers for one configured app without rebuilding them. */
export async function deployUpApp(
  deps: DeployDeps,
  appName: string,
): Promise<DeployError | undefined> {
  const ready = await deployResolveAppCompose(deps, appName)
  if (ready instanceof Error) return ready
  const result = await deployRunOrReturnError(() =>
    ready.compose.up({
      services: ready.appCfg.services ?? [],
      buildArgs: ready.appCfg.build_args ?? {},
    }),
  )
  return result instanceof Error ? result : undefined
}

/** Stops one configured app and optionally removes volumes. */
export async function deployDownApp(
  deps: DeployDeps,
  appName: string,
  removeVolumes = false,
): Promise<DeployError | undefined> {
  const ready = await deployResolveAppCompose(deps, appName)
  if (ready instanceof Error) return ready
  const result = await deployRunOrReturnError(() => ready.compose.down(removeVolumes))
  return result instanceof Error ? result : undefined
}

/** Restarts containers for one configured app without changing the deployed SHA. */
export async function deployRestartApp(
  deps: DeployDeps,
  appName: string,
): Promise<DeployError | undefined> {
  const ready = await deployResolveAppCompose(deps, appName)
  if (ready instanceof Error) return ready
  const result = await deployRunOrReturnError(() => ready.compose.restart())
  return result instanceof Error ? result : undefined
}
