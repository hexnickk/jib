import { rm } from 'node:fs/promises'
import { pathExists } from '@jib/paths'
import * as git from './git.ts'

/** Converts an unknown source failure into `ErrorOptions` cause metadata. */
export function sourcesErrorOptions(error: unknown): ErrorOptions | undefined {
  return error === undefined ? undefined : { cause: error }
}

/** Ensures `workdir` is a usable checkout and returns a typed git error on failure. */
export async function sourcesEnsureCheckout(
  workdir: string,
  url: string,
  branch: string,
  env: git.GitEnv,
): Promise<Error | undefined> {
  if (await pathExists(workdir)) {
    const [repoReady, hasRemote] = await Promise.all([
      git.sourcesGitIsRepo(workdir),
      git.sourcesGitHasRemote(workdir),
    ])
    if (!repoReady || !hasRemote) {
      await rm(workdir, { recursive: true, force: true })
    }
  }

  if (!(await pathExists(workdir))) {
    const cloneError = await git.sourcesGitClone(url, workdir, { branch, env })
    if (cloneError instanceof Error) {
      await rm(workdir, { recursive: true, force: true })
      return cloneError
    }
    return
  }

  return git.sourcesGitSetRemoteUrl(workdir, url)
}
