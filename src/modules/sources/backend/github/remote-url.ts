import { $ } from '@/libs/shell'
import { InternalError } from '@jib/errors'

/** Canonical SSH clone URL for `owner/repo`. */
export function githubRemoteSshCloneUrl(repo: string): string {
  return `git@github.com:${repo}.git`
}

/** Builds an HTTPS clone URL and embeds an installation token when provided. */
export function githubRemoteHttpsCloneUrl(repo: string, token?: string): string {
  if (!token) {
    return `https://github.com/${repo}.git`
  }
  return `https://x-access-token:${encodeURIComponent(token)}@github.com/${repo}.git`
}

/** Rewrites a checkout's origin URL to use a GitHub installation token. */
export async function githubRemoteSetToken(
  repoDir: string,
  repo: string,
  token: string,
): Promise<InternalError | undefined> {
  const url = githubRemoteHttpsCloneUrl(repo, token)
  try {
    const result = await $`git -C ${repoDir} remote set-url origin ${url}`
    if (result.exitCode !== 0) {
      return new InternalError(
        `git remote set-url: ${
          result.stderr.trim() ||
          result.stdout.trim() ||
          `command exited with code ${result.exitCode ?? 1}`
        }`,
      )
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return new InternalError(`git remote set-url: ${message}`, { cause: error })
  }
}
