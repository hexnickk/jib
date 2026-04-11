import { JibError } from '@jib/core'
import { $ } from 'bun'

/** Canonical SSH clone URL for `owner/repo`. */
export function sshCloneURL(repo: string): string {
  return `git@github.com:${repo}.git`
}

/**
 * HTTPS clone URL, optionally embedding a token via the `x-access-token`
 * username GitHub App installation tokens use. The token is URL-encoded to
 * survive any unusual characters GitHub might ship.
 */
export function httpsCloneURL(repo: string, token?: string): string {
  if (!token) return `https://github.com/${repo}.git`
  return `https://x-access-token:${encodeURIComponent(token)}@github.com/${repo}.git`
}

/**
 * Rewrites a repo's `origin` remote URL in place so subsequent git operations
 * use the supplied installation token. Only touches git config — pure
 * shell-out. Lives in `modules/sources/backend/github` because the URL shape is
 * GitHub-specific; watcher/source sync code imports it and applies it to
 * a workdir.
 */
export async function setRemoteToken(repoDir: string, repo: string, token: string): Promise<void> {
  const url = httpsCloneURL(repo, token)
  const res = await $`git -C ${repoDir} remote set-url origin ${url}`.quiet().nothrow()
  if (res.exitCode !== 0) {
    throw new JibError('github.remote', `git remote set-url: ${res.stderr.toString()}`)
  }
}
