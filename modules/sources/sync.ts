import { pathExists } from '@jib/paths'
import { sourcesEnsureCheckout, sourcesErrorOptions } from './checkout.ts'
import { SourceLocalCheckoutError, SourceRemoteSyncError } from './errors.ts'
import * as git from './git.ts'
import type { PreparedSource, ResolvedSource } from './types.ts'

/** Syncs an existing local repo workdir and returns its pinned SHA. */
export async function sourcesSyncLocalCheckout(
  appName: string,
  workdir: string,
  ref: string,
): Promise<PreparedSource | SourceLocalCheckoutError> {
  try {
    if (!(await pathExists(workdir)) || !(await git.sourcesGitIsRepo(workdir))) {
      return new SourceLocalCheckoutError(appName, workdir)
    }
    const checkoutError = await git.sourcesGitCheckout(workdir, ref)
    if (checkoutError instanceof Error) {
      return new SourceLocalCheckoutError(appName, workdir, sourcesErrorOptions(checkoutError))
    }

    const sha = await git.sourcesGitCurrentSha(workdir)
    if (sha instanceof Error) {
      return new SourceLocalCheckoutError(appName, workdir, sourcesErrorOptions(sha))
    }

    return { workdir, sha }
  } catch (error) {
    return new SourceLocalCheckoutError(appName, workdir, sourcesErrorOptions(error))
  }
}

/** Syncs a remote repo workdir and returns the fetched immutable SHA. */
export async function sourcesSyncRemoteCheckout(
  appName: string,
  source: ResolvedSource,
): Promise<PreparedSource | SourceRemoteSyncError> {
  try {
    const checkoutError = await sourcesEnsureCheckout(
      source.workdir,
      source.url,
      source.branch,
      source.env,
    )
    if (checkoutError instanceof Error) {
      return new SourceRemoteSyncError(appName, source.ref, sourcesErrorOptions(checkoutError))
    }
  } catch (error) {
    return new SourceRemoteSyncError(appName, source.ref, sourcesErrorOptions(error))
  }

  const authError = await source.applyAuth(source.workdir)
  if (authError instanceof Error) {
    return new SourceRemoteSyncError(appName, source.ref, sourcesErrorOptions(authError))
  }

  const fetchError = await git.sourcesGitFetch(source.workdir, source.ref, source.env)
  if (fetchError instanceof Error) {
    return new SourceRemoteSyncError(appName, source.ref, sourcesErrorOptions(fetchError))
  }

  const sha = await git.sourcesGitFetchedSha(source.workdir)
  if (sha instanceof Error) {
    return new SourceRemoteSyncError(appName, source.ref, sourcesErrorOptions(sha))
  }

  const checkoutError = await git.sourcesGitCheckout(source.workdir, sha)
  if (checkoutError instanceof Error) {
    return new SourceRemoteSyncError(appName, source.ref, sourcesErrorOptions(checkoutError))
  }

  return { workdir: source.workdir, sha }
}
