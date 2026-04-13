import { readFile } from 'node:fs/promises'
import type { App, Config } from '@jib/config'
import { type Paths, pathsCredsPath } from '@jib/paths'
import { githubGetSource } from './config-edit.ts'
import {
  GitHubAuthInvalidRepoError,
  GitHubAuthMissingAppIdError,
  GitHubAuthReadPemError,
  GitHubAuthSourceNotFoundError,
} from './errors.ts'
import { githubInstallationFindForOrg } from './installation.ts'
import { githubJwtGenerateInstallationToken } from './jwt.ts'
import { githubDeployKeyPaths } from './keygen.ts'
import { githubRemoteSetToken } from './remote-url.ts'

/**
 * Result of resolving live git credentials for a repo. At most one of the
 * two fields is set depending on source type: `sshKeyPath` for deploy-key
 * sources (caller sets `GIT_SSH_COMMAND`), `token` for GitHub App sources
 * (caller rewrites the origin URL).
 */
export interface AuthResult {
  sshKeyPath?: string
  token?: string
}

/** On-disk path for a GitHub App source's PEM file. */
export function githubAuthPemPath(paths: Paths, sourceName: string): string {
  return pathsCredsPath(paths, 'github-app', `${sourceName}.pem`)
}

/**
 * Resolves fresh credentials for an app's configured source. Deploy keys
 * are stateless (return the key path); GitHub App sources mint a new
 * installation token on every call since they're short-lived (~1 hour).
 *
 * Called by the watcher/source sync flows before every `fetch`/`clone` — it's the only
 * consumer of this module's network code.
 */
export async function githubAuthRefresh(
  sourceName: string,
  cfg: Config,
  app: App,
  paths: Paths,
): Promise<AuthResult | Error> {
  const source = githubGetSource(cfg, sourceName)
  if (!source) {
    return new GitHubAuthSourceNotFoundError(sourceName)
  }
  if (source.type === 'key') {
    return { sshKeyPath: githubDeployKeyPaths(paths, sourceName).privateKey }
  }
  if (!source.app_id) return new GitHubAuthMissingAppIdError(sourceName)
  const pemPath = githubAuthPemPath(paths, sourceName)
  let pem: string
  try {
    pem = await readFile(pemPath, 'utf8')
  } catch (error) {
    return new GitHubAuthReadPemError(pemPath, error)
  }
  const org = app.repo.split('/')[0] ?? ''
  if (!org) return new GitHubAuthInvalidRepoError(app.repo)
  const installationId = await githubInstallationFindForOrg(source.app_id, pem, org)
  if (installationId instanceof Error) return installationId
  const installationToken = await githubJwtGenerateInstallationToken(
    source.app_id,
    pem,
    installationId,
  )
  if (installationToken instanceof Error) return installationToken
  return { token: installationToken.token }
}

/**
 * Apply an `AuthResult` to a checked-out repo so subsequent git commands
 * authenticate correctly. For SSH: nothing to do on disk (caller must set
 * `GIT_SSH_COMMAND`). For tokens: rewrite the `origin` remote URL.
 */
export async function githubAuthApply(
  auth: AuthResult,
  repoDir: string,
  repo: string,
): Promise<Error | undefined> {
  if (auth.token) return githubRemoteSetToken(repoDir, repo, auth.token)
}
