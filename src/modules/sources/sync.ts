import { InternalError, type JibError } from '@jib/errors'
import { pathsPathExistsResult } from '@jib/paths'
import { sourcesEnsureCheckout } from './checkout.ts'
import * as git from './git.ts'
import type { PreparedSource, ResolvedSource } from './types.ts'

/** Syncs an existing local repo workdir and returns its pinned SHA. */
export async function sourcesSyncLocalCheckout(
  appName: string,
  workdir: string,
  ref: string,
): Promise<PreparedSource | JibError> {
  try {
    const exists = await pathsPathExistsResult(workdir)
    if (exists instanceof Error) {
      return exists
    }
    if (!exists || !(await git.sourcesGitIsRepo(workdir))) {
      return new InternalError(`failed to sync local repo for app "${appName}" at ${workdir}`)
    }
    const checkoutError = await git.sourcesGitCheckout(workdir, ref)
    if (checkoutError instanceof Error) {
      return checkoutError
    }

    const sha = await git.sourcesGitCurrentSha(workdir)
    if (sha instanceof Error) {
      return sha
    }
    return { workdir, sha }
  } catch (error) {
    return new InternalError(`failed to sync local repo for app "${appName}" at ${workdir}`, {
      cause: error,
    })
  }
}

/** Syncs a remote repo workdir and returns the fetched immutable SHA. */
export async function sourcesSyncRemoteCheckout(
  appName: string,
  source: ResolvedSource,
): Promise<PreparedSource | JibError> {
  try {
    const checkoutError = await sourcesEnsureCheckout(
      source.workdir,
      source.url,
      source.branch,
      source.env,
    )
    if (checkoutError instanceof Error) {
      return checkoutError
    }
  } catch (error) {
    return new InternalError(
      `failed to sync remote source for app "${appName}" at ref "${source.ref}"`,
      { cause: error },
    )
  }

  const authError = await source.applyAuth(source.workdir)
  if (authError instanceof Error) {
    return authError
  }

  const fetchError = await git.sourcesGitFetch(source.workdir, source.ref, source.env)
  if (fetchError instanceof Error) {
    return fetchError
  }

  const sha = await git.sourcesGitFetchedSha(source.workdir)
  if (sha instanceof Error) {
    return sha
  }

  const checkoutError = await git.sourcesGitCheckout(source.workdir, sha)
  if (checkoutError instanceof Error) {
    return checkoutError
  }

  return { workdir: source.workdir, sha }
}
