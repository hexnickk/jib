import { stat, symlink, unlink } from 'node:fs/promises'
import { join } from 'node:path'
import type { App } from '@jib/config'
import { dockerParseComposeServices, dockerWriteOverride } from '@jib/docker'
import { InternalError, type JibError, errorsToJibError } from '@jib/errors'
import { $ } from '@/libs/shell'
import { deployBuildOverrideServices } from './override.ts'
import type { DeployDeps } from './types.ts'

/** Regenerates the jib-managed compose override file for one app. */
export async function deploySyncOverride(
  deps: DeployDeps,
  app: string,
  appCfg: App,
  workdir: string,
): Promise<JibError | undefined> {
  try {
    const parsed = dockerParseComposeServices(workdir, appCfg.compose ?? [])
    const services = deployBuildOverrideServices(parsed, appCfg.domains)
    await dockerWriteOverride(deps.paths.overridesDir, app, services)
  } catch (error) {
    return errorsToJibError(error)
  }
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
    const message = error instanceof Error ? error.message : String(error)
    return new InternalError(message, { cause: error })
  }

  try {
    const dest = join(workdir, '.env')
    await unlink(dest).catch(() => undefined)
    await symlink(src, dest)
  } catch (error) {
    return errorsToJibError(error)
  }
}

/** Reads free disk space for the target workdir, using the injected override when present. */
export async function deployReadDiskFree(
  deps: DeployDeps,
  path: string,
): Promise<JibError | number> {
  try {
    if (deps.diskFree) {
      return await deps.diskFree(path)
    }
    const result = await $`df -B1 --output=avail ${path}`
    if (result.exitCode !== 0) {
      return Number.POSITIVE_INFINITY
    }
    const line = result.stdout.trim().split('\n')[1] ?? '0'
    return Number(line.trim())
  } catch (error) {
    return errorsToJibError(error)
  }
}
