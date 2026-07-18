import { rm } from 'node:fs/promises'
import { type JibError, errorsToJibError } from '@jib/errors'
import { pathsPathExistsResult } from '@jib/paths'
import * as git from './git.ts'

/** Ensures `workdir` is a usable checkout and returns a typed Git or filesystem error on failure. */
export async function sourcesEnsureCheckout(
  workdir: string,
  url: string,
  branch: string,
  env: git.GitEnv,
): Promise<JibError | undefined> {
  try {
    const initialExists = await pathsPathExistsResult(workdir)
    if (initialExists instanceof Error) {
      return initialExists
    }

    let workdirExists = initialExists
    if (workdirExists) {
      const [repoReady, hasRemote] = await Promise.all([
        git.sourcesGitIsRepo(workdir),
        git.sourcesGitHasRemote(workdir),
      ])
      if (!repoReady || !hasRemote) {
        await rm(workdir, { recursive: true, force: true })
        workdirExists = false
      }
    }

    if (!workdirExists) {
      const cloneError = await git.sourcesGitClone(url, workdir, { branch, env })
      if (cloneError instanceof Error) {
        await rm(workdir, { recursive: true, force: true })
        return cloneError
      }
      return undefined
    }

    return await git.sourcesGitSetRemoteUrl(workdir, url)
  } catch (error) {
    return errorsToJibError(error)
  }
}
