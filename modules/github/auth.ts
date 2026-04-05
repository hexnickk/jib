import { readFile } from 'node:fs/promises'
import type { App, Config } from '@jib/config'
import { JibError, type Paths, credsPath } from '@jib/core'
import { getProvider } from './config-edit.ts'
import { findInstallationForOrg } from './installation.ts'
import { generateInstallationToken } from './jwt.ts'
import { deployKeyPaths } from './keygen.ts'
import { setRemoteToken } from './remote-url.ts'

/**
 * Result of resolving live git credentials for a repo. At most one of the
 * two fields is set depending on provider type: `sshKeyPath` for deploy-key
 * providers (caller sets `GIT_SSH_COMMAND`), `token` for GitHub App providers
 * (caller rewrites the origin URL).
 */
export interface AuthResult {
  sshKeyPath?: string
  token?: string
}

/** On-disk path for a GitHub App's PEM file. */
export function appPemPath(paths: Paths, providerName: string): string {
  return credsPath(paths, 'github-app', `${providerName}.pem`)
}

/**
 * Resolves fresh credentials for an app's configured provider. Deploy keys
 * are stateless (return the key path); GitHub App providers mint a new
 * installation token on every call since they're short-lived (~1 hour).
 *
 * Called by `modules/gitsitter` before every `fetch`/`clone` — it's the only
 * consumer of this module's network code.
 */
export async function refreshAuth(
  providerName: string,
  cfg: Config,
  app: App,
  paths: Paths,
): Promise<AuthResult> {
  const provider = getProvider(cfg, providerName)
  if (!provider) {
    throw new JibError('github.auth', `provider "${providerName}" not found in config`)
  }
  if (provider.type === 'key') {
    return { sshKeyPath: deployKeyPaths(paths, providerName).privateKey }
  }
  if (!provider.app_id)
    throw new JibError('github.auth', `provider "${providerName}" missing app_id`)
  const pem = await readFile(appPemPath(paths, providerName), 'utf8')
  const org = app.repo.split('/')[0] ?? ''
  if (!org) throw new JibError('github.auth', `invalid repo "${app.repo}"`)
  const installationId = await findInstallationForOrg(provider.app_id, pem, org)
  const { token } = await generateInstallationToken(provider.app_id, pem, installationId)
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
