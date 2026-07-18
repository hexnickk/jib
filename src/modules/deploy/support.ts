import { existsSync } from 'node:fs'
import { stat, symlink, unlink } from 'node:fs/promises'
import { join } from 'node:path'
import { $ } from '@/libs/shell'
import type { App } from '@jib/config'
import {
  type DockerCompose,
  dockerCreateCompose,
  dockerOverridePath,
  dockerParseComposeServices,
  dockerWriteOverride,
} from '@jib/docker'
import { InternalError, JibError } from '@jib/errors'
import {
  type AppState,
  type StateStore,
  stateAcquireLock,
  stateLoad,
  stateRecordFailure,
  stateSave,
} from '@jib/state'
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
  const envPath = join(deps.paths.secretsDir, app, '.env')
  return dockerCreateCompose({
    app,
    dir: workdir,
    files: [...files],
    override: dockerOverridePath(deps.paths.overridesDir, app),
    ...(existsSync(envPath) ? { envFile: envPath } : {}),
    ...(deps.dockerExec ? { exec: deps.dockerExec } : {}),
  })
}

/** Regenerates the jib-managed compose override file for one app. */
export async function deploySyncOverride(
  deps: DeployDeps,
  app: string,
  appCfg: App,
  workdir: string,
): Promise<JibError | undefined> {
  const result = await deployRunOrReturnError(async () => {
    const parsed = dockerParseComposeServices(workdir, appCfg.compose ?? [])
    const services = deployBuildOverrideServices(parsed, appCfg.domains)
    await dockerWriteOverride(deps.paths.overridesDir, app, services)
  })
  return result instanceof Error ? result : undefined
}

/** Symlinks the managed env file into the prepared workdir when one exists. */
export async function deployLinkSecrets(
  deps: DeployDeps,
  app: string,
  workdir: string,
): Promise<JibError | undefined> {
  const src = join(deps.paths.secretsDir, app, '.env')
  try {
    await stat(src)
  } catch (error) {
    const code = typeof error === 'object' && error && 'code' in error ? error.code : undefined
    if (code === 'ENOENT') {
      return
    }
    return new InternalError(messageOf(error), { cause: error })
  }

  const result = await deployRunOrReturnError(async () => {
    const dest = join(workdir, '.env')
    await unlink(dest).catch(() => undefined)
    await symlink(src, dest)
  })
  return result instanceof Error ? result : undefined
}

/** Reads free disk space for the target workdir, using the injected override when present. */
export async function deployReadDiskFree(
  deps: DeployDeps,
  path: string,
): Promise<JibError | number> {
  return deployRunOrReturnError(async () => {
    if (deps.diskFree) {
      return deps.diskFree(path)
    }
    const result = await $`df -B1 --output=avail ${path}`
    if (result.exitCode !== 0) {
      return Number.POSITIVE_INFINITY
    }
    const line = result.stdout.trim().split('\n')[1] ?? '0'
    return Number(line.trim())
  })
}

/** Acquires the non-blocking deploy lock for one app. */
export async function deployAcquireLock(
  deps: DeployDeps,
  app: string,
): Promise<(() => Promise<void>) | JibError> {
  const release = await stateAcquireLock(deps.paths.locksDir, app, { blocking: false })
  if (release instanceof Error) {
    return new InternalError(`acquire lock for ${app}: ${release.message}`, { cause: release })
  }
  return release
}

/** Releases a previously acquired deploy lock. */
export async function deployReleaseLock(
  app: string,
  release: () => Promise<void>,
): Promise<JibError | undefined> {
  const result = await deployRunOrReturnError(() => release())
  if (!(result instanceof Error)) {
    return undefined
  }
  return new InternalError(`release lock for ${app}: ${result.message}`, { cause: result })
}

/** Loads the persisted deploy state for one app. */
export async function deployReadState(
  store: StateStore,
  app: string,
): Promise<AppState | JibError> {
  const result = await stateLoad(store, app)
  return result instanceof Error ? result : result
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

/** Runs an async deploy helper and converts thrown failures into shared result errors. */
export async function deployRunOrReturnError<T>(run: () => Promise<T>): Promise<JibError | T> {
  try {
    return await run()
  } catch (error) {
    return deployCoerceError(error)
  }
}

/** Normalizes unknown thrown values into a shared internal error. */
export function deployCoerceError(error: unknown): JibError {
  if (error instanceof JibError) {
    return error
  }
  return new InternalError(messageOf(error), { cause: error })
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
