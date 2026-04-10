import { readFile } from 'node:fs/promises'
import type { App, Config } from '@jib/config'
import { JibError, type Paths, credsPath } from '@jib/core'
import { getGitHubSource } from './config-edit.ts'
import { findInstallationForOrg } from './installation.ts'
import { generateInstallationToken } from './jwt.ts'
import { deployKeyPaths } from './keygen.ts'
import { setRemoteToken } from './remote-url.ts'

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
export function appPemPath(paths: Paths, sourceName: string): string {
  return credsPath(paths, 'github-app', `${sourceName}.pem`)
}

/**
 * Resolves fresh credentials for an app's configured source. Deploy keys
 * are stateless (return the key path); GitHub App sources mint a new
 * installation token on every call since they're short-lived (~1 hour).
 *
 * Called by `modules/gitsitter` before every `fetch`/`clone` — it's the only
 * consumer of this module's network code.
 */
export async function refreshAuth(
  sourceName: string,
  cfg: Config,
  app: App,
  paths: Paths,
): Promise<AuthResult> {
  const source = getGitHubSource(cfg, sourceName)
  if (!source) {
    throw new JibError('github.auth', `source "${sourceName}" not found in config`)
  }
  if (source.type === 'key') {
    return { sshKeyPath: deployKeyPaths(paths, sourceName).privateKey }
  }
  if (!source.app_id) throw new JibError('github.auth', `source "${sourceName}" missing app_id`)
  const pem = await readFile(appPemPath(paths, sourceName), 'utf8')
  const org = app.repo.split('/')[0] ?? ''
  if (!org) throw new JibError('github.auth', `invalid repo "${app.repo}"`)
  const installationId = await findInstallationForOrg(source.app_id, pem, org)
  const { token } = await generateInstallationToken(source.app_id, pem, installationId)
  return { token }
}

/**
 * Apply an `AuthResult` to a checked-out repo so subsequent git commands
 * authenticate correctly. For SSH: nothing to do on disk (caller must set
 * `GIT_SSH_COMMAND`). For tokens: rewrite the `origin` remote URL.
 */
export async function applyAuth(auth: AuthResult, repoDir: string, repo: string): Promise<void> {
  if (auth.token) await setRemoteToken(repoDir, repo, auth.token)
}
