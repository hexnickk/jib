import { stat, symlink, unlink } from 'node:fs/promises'
import { join } from 'node:path'
import type { App } from '@jib/config'
import { dockerParseComposeServices, dockerWriteOverride } from '@jib/docker'
import { InternalError, type JibError, errorsToJibError } from '@jib/errors'
import type { Paths } from '@jib/paths'
import { $ } from '@/libs/shell'
import { deployBuildOverrideServices } from './override.ts'

// Approved exception to the ctx convention: pass a lone dependency directly.
/** Regenerates the jib-managed compose override file for one app. */
export async function deploySyncOverride(
  paths: Paths,
  app: string,
  appCfg: App,
  workdir: string,
): Promise<JibError | undefined> {
  try {
    const parsed = dockerParseComposeServices(workdir, appCfg.compose ?? [])
    const services = deployBuildOverrideServices(parsed, appCfg.domains)
    await dockerWriteOverride(paths.overridesDir, app, services)
  } catch (error) {
    return errorsToJibError(error)
  }
}

/** Symlinks the managed env file into the prepared workdir when one exists. */
export async function deployLinkSecrets(
  paths: Paths,
  app: string,
  workdir: string,
): Promise<JibError | undefined> {
  const src = join(paths.secretsDir, app, '.env')
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

/** Reads free disk space for the target workdir. */
export async function deployReadDiskFree(path: string): Promise<JibError | number> {
  try {
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
