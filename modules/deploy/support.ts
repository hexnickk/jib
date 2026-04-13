import { stat, symlink, unlink } from 'node:fs/promises'
import { join } from 'node:path'
import type { App } from '@jib/config'
import {
  type DockerCompose,
  dockerCreateCompose,
  dockerOverridePath,
  dockerParseComposeServices,
  dockerWriteOverride,
} from '@jib/docker'
import { JibError } from '@jib/errors'
import {
  type AppState,
  type StateStore,
  stateAcquire,
  stateLoad,
  stateRecordFailure,
  stateSave,
} from '@jib/state'
import { $ } from 'bun'
import {
  DeployDiskCheckError,
  DeployLockAcquireError,
  DeployLockReleaseError,
  DeployOverrideSyncError,
  DeploySecretsLinkError,
  DeployUnexpectedError,
} from './errors.ts'
import { deployBuildOverrideServices } from './override.ts'
import type { DeployDeps } from './types.ts'

/** Creates the compose runner for one app, including jib-managed override wiring. */
export function deployNewCompose(
  deps: DeployDeps,
  app: string,
  appCfg: App,
  workdir: string,
): DockerCompose {
  const files =
    appCfg.compose && appCfg.compose.length > 0 ? appCfg.compose : ['docker-compose.yml']
  return dockerCreateCompose({
    app,
    dir: workdir,
    files: [...files],
    override: dockerOverridePath(deps.paths.overridesDir, app),
    ...(deps.dockerExec ? { exec: deps.dockerExec } : {}),
  })
}

/** Regenerates the jib-managed compose override file for one app. */
export async function deploySyncOverride(
  deps: DeployDeps,
  app: string,
  appCfg: App,
  workdir: string,
): Promise<DeployOverrideSyncError | JibError | undefined> {
  const result = await deployRunOrReturnError(
    async () => {
      const parsed = dockerParseComposeServices(workdir, appCfg.compose ?? [])
      const services = deployBuildOverrideServices(parsed, appCfg.domains)
      await dockerWriteOverride(deps.paths.overridesDir, app, services)
    },
    (message, options) => new DeployOverrideSyncError(message, options),
  )
  return result instanceof Error ? result : undefined
}

/** Symlinks the managed env file into the prepared workdir when one exists. */
export async function deployLinkSecrets(
  deps: DeployDeps,
  app: string,
  appCfg: App,
  workdir: string,
): Promise<DeploySecretsLinkError | undefined> {
  const envName = appCfg.env_file ?? '.env'
  const src = join(deps.paths.secretsDir, app, envName)
  try {
    await stat(src)
  } catch (error) {
    const code = typeof error === 'object' && error && 'code' in error ? error.code : undefined
    if (code === 'ENOENT') return
    return new DeploySecretsLinkError(messageOf(error), { cause: error })
  }

  const result = await deployRunOrReturnError(
    async () => {
      const dest = join(workdir, envName)
      await unlink(dest).catch(() => undefined)
      await symlink(src, dest)
    },
    (message, options) => new DeploySecretsLinkError(message, options),
  )
  return result instanceof Error ? result : undefined
}

/** Reads free disk space for the target workdir, using the injected override when present. */
export async function deployReadDiskFree(
  deps: DeployDeps,
  path: string,
): Promise<DeployDiskCheckError | number> {
  return deployRunOrReturnError(
    async () => {
      if (deps.diskFree) return deps.diskFree(path)
      const res = await $`df -B1 --output=avail ${path}`.quiet().nothrow()
      if (res.exitCode !== 0) return Number.POSITIVE_INFINITY
      const line = res.stdout.toString().trim().split('\n')[1] ?? '0'
      return Number(line.trim())
    },
    (message, options) => new DeployDiskCheckError(message, options),
  )
}

/** Acquires the non-blocking deploy lock for one app. */
export async function deployAcquireLock(
  deps: DeployDeps,
  app: string,
): Promise<(() => Promise<void>) | DeployLockAcquireError | JibError> {
  return deployRunOrReturnError(
    () => stateAcquire(deps.paths.locksDir, app, { blocking: false }),
    (message, options) => new DeployLockAcquireError(app, message, options),
  )
}

/** Releases a previously acquired deploy lock. */
export async function deployReleaseLock(
  app: string,
  release: () => Promise<void>,
): Promise<DeployLockReleaseError | JibError | undefined> {
  const result = await deployRunOrReturnError(
    () => release(),
    (message, options) => new DeployLockReleaseError(app, message, options),
  )
  return result instanceof Error ? result : undefined
}

/** Loads the persisted deploy state for one app. */
export async function deployReadState(
  store: StateStore,
  app: string,
): Promise<AppState | JibError> {
  const result = await stateLoad(store, app)
  return result instanceof JibError ? result : result
}

/** Persists updated deploy state for one app. */
export async function deployWriteState(
  store: StateStore,
  app: string,
  state: AppState,
): Promise<JibError | undefined> {
  const result = await stateSave(store, app, state)
  return result instanceof Error ? result : undefined
}

/** Records a failed deploy message in app state without throwing. */
export async function deployRecordFailure(
  deps: DeployDeps,
  app: string,
  message: string,
): Promise<JibError | undefined> {
  const result = await stateRecordFailure(deps.store, app, message)
  return result instanceof Error ? result : undefined
}

/** Runs an async deploy helper and converts thrown failures into returned typed errors. */
export async function deployRunOrReturnError<T, E extends JibError = JibError>(
  run: () => Promise<T>,
  fallback?: (message: string, options?: ErrorOptions) => E,
): Promise<E | JibError | T> {
  try {
    return await run()
  } catch (error) {
    return deployCoerceError(error, fallback)
  }
}

/** Normalizes unknown thrown values into deploy-scoped typed errors. */
export function deployCoerceError<E extends JibError = JibError>(
  error: unknown,
  fallback?: (message: string, options?: ErrorOptions) => E,
): E | JibError {
  if (error instanceof JibError) return error
  const message = messageOf(error)
  if (fallback) return fallback(message, { cause: error })
  return new DeployUnexpectedError(message, { cause: error })
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
