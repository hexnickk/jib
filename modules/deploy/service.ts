import { DeployMissingAppError } from './errors.ts'
import { resolveAppCompose, runDeployFlow } from './flow.ts'
import {
  acquireDeployLock,
  recordDeployFailure,
  releaseDeployLock,
  runOrReturnError,
} from './support.ts'
import type { DeployCmd, DeployError, DeployResult, EngineDeps, ProgressCtx } from './types.ts'

export { MIN_DISK_BYTES } from './types.ts'
export type { DeployCmd, DeployError, DeployResult, EngineDeps, ProgressCtx } from './types.ts'

export async function deployApp(
  deps: EngineDeps,
  cmd: DeployCmd,
  progress: ProgressCtx,
): Promise<DeployError | DeployResult> {
  const appCfg = deps.config.apps[cmd.app]
  if (!appCfg) return new DeployMissingAppError(cmd.app)

  progress.emit('lock', `acquiring lock for ${cmd.app}`)
  const release = await acquireDeployLock(deps, cmd.app)
  if (release instanceof Error) return release

  const result = await runDeployFlow(deps, cmd, appCfg, progress)
  if (result instanceof Error) {
    deps.log.error(`deploy ${cmd.app} failed: ${result.message}`)
    const recordFailureError = await recordDeployFailure(deps, cmd.app, result.message)
    if (recordFailureError) {
      deps.log.error(`deploy ${cmd.app} failure state update failed: ${recordFailureError.message}`)
    }
  }

  const releaseError = await releaseDeployLock(cmd.app, release)
  if (releaseError) {
    if (!(result instanceof Error)) return releaseError
    deps.log.error(`deploy ${cmd.app} lock release failed: ${releaseError.message}`)
  }
  return result
}

export async function upApp(deps: EngineDeps, appName: string): Promise<DeployError | undefined> {
  const ready = await resolveAppCompose(deps, appName)
  if (ready instanceof Error) return ready
  const result = await runOrReturnError(() =>
    ready.compose.up({
      services: ready.appCfg.services ?? [],
      buildArgs: ready.appCfg.build_args ?? {},
    }),
  )
  return result instanceof Error ? result : undefined
}

export async function downApp(
  deps: EngineDeps,
  appName: string,
  removeVolumes = false,
): Promise<DeployError | undefined> {
  const ready = await resolveAppCompose(deps, appName)
  if (ready instanceof Error) return ready
  const result = await runOrReturnError(() => ready.compose.down(removeVolumes))
  return result instanceof Error ? result : undefined
}

export async function restartApp(
  deps: EngineDeps,
  appName: string,
): Promise<DeployError | undefined> {
  const ready = await resolveAppCompose(deps, appName)
  if (ready instanceof Error) return ready
  const result = await runOrReturnError(() => ready.compose.restart())
  return result instanceof Error ? result : undefined
}
