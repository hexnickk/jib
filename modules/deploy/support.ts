import { stat, symlink, unlink } from 'node:fs/promises'
import { join } from 'node:path'
import type { App } from '@jib/config'
import { Compose, overridePath, parseComposeServices, writeOverride } from '@jib/docker'
import { JibError } from '@jib/errors'
import { type AppState, type Store, acquire } from '@jib/state'
import { $ } from 'bun'
import {
  DeployDiskCheckError,
  DeployLockAcquireError,
  DeployLockReleaseError,
  DeployOverrideSyncError,
  DeploySecretsLinkError,
  DeployUnexpectedError,
} from './errors.ts'
import { buildOverrideServices } from './override.ts'
import type { EngineDeps } from './types.ts'

export function newCompose(deps: EngineDeps, app: string, appCfg: App, workdir: string): Compose {
  const files =
    appCfg.compose && appCfg.compose.length > 0 ? appCfg.compose : ['docker-compose.yml']
  return new Compose({
    app,
    dir: workdir,
    files: [...files],
    override: overridePath(deps.paths.overridesDir, app),
    ...(deps.dockerExec ? { exec: deps.dockerExec } : {}),
  })
}

export async function syncOverride(
  deps: EngineDeps,
  app: string,
  appCfg: App,
  workdir: string,
): Promise<DeployOverrideSyncError | JibError | undefined> {
  const result = await runOrReturnError(
    async () => {
      const parsed = parseComposeServices(workdir, appCfg.compose ?? [])
      const services = buildOverrideServices(parsed, appCfg.domains)
      await writeOverride(deps.paths.overridesDir, app, services)
    },
    (message, options) => new DeployOverrideSyncError(message, options),
  )
  return result instanceof Error ? result : undefined
}

export async function linkSecrets(
  deps: EngineDeps,
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

  const result = await runOrReturnError(
    async () => {
      const dest = join(workdir, envName)
      await unlink(dest).catch(() => undefined)
      await symlink(src, dest)
    },
    (message, options) => new DeploySecretsLinkError(message, options),
  )
  return result instanceof Error ? result : undefined
}

export async function readDiskFree(
  deps: EngineDeps,
  path: string,
): Promise<DeployDiskCheckError | number> {
  return runOrReturnError(
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

export async function acquireDeployLock(
  deps: EngineDeps,
  app: string,
): Promise<(() => Promise<void>) | DeployLockAcquireError | JibError> {
  return runOrReturnError(
    () => acquire(deps.paths.locksDir, app, { blocking: false }),
    (message, options) => new DeployLockAcquireError(app, message, options),
  )
}

export async function releaseDeployLock(
  app: string,
  release: () => Promise<void>,
): Promise<DeployLockReleaseError | JibError | undefined> {
  const result = await runOrReturnError(
    () => release(),
    (message, options) => new DeployLockReleaseError(app, message, options),
  )
  return result instanceof Error ? result : undefined
}

export async function readState(store: Store, app: string): Promise<AppState | JibError> {
  return runOrReturnError(() => store.load(app))
}

export async function writeState(
  store: Store,
  app: string,
  state: AppState,
): Promise<JibError | undefined> {
  const result = await runOrReturnError(() => store.save(app, state))
  return result instanceof Error ? result : undefined
}

export async function recordDeployFailure(
  deps: EngineDeps,
  app: string,
  message: string,
): Promise<JibError | undefined> {
  const result = await runOrReturnError(() => deps.store.recordFailure(app, message))
  return result instanceof Error ? result : undefined
}

export async function runOrReturnError<T, E extends JibError = JibError>(
  run: () => Promise<T>,
  fallback?: (message: string, options?: ErrorOptions) => E,
): Promise<E | JibError | T> {
  try {
    return await run()
  } catch (error) {
    return coerceDeployError(error, fallback)
  }
}

export function coerceDeployError<E extends JibError = JibError>(
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
