import { readFile } from 'node:fs/promises'
import type { App, Config } from '@jib/config'
import { InternalError, type JibError, NotFoundError, ValidationError } from '@jib/errors'
import { type Paths, pathsCredsPath } from '@jib/paths'
import { githubGetSource } from './config-edit.ts'
import { githubInstallationFindForOrg } from './installation.ts'
import { githubJwtGenerateInstallationToken } from './jwt.ts'
import { githubDeployKeyPaths } from './keygen.ts'
import { githubRemoteSetToken } from './remote-url.ts'

/** Result of resolving live git credentials for a repo. */
export interface AuthResult {
  sshKeyPath?: string
  token?: string
}

/** On-disk path for a GitHub App source's PEM file. */
export function githubAuthPemPath(paths: Paths, sourceName: string): string {
  return pathsCredsPath(paths, 'github-app', `${sourceName}.pem`)
}

/** Resolves fresh credentials for an app's configured GitHub source. */
export async function githubAuthRefresh(
  sourceName: string,
  cfg: Config,
  app: App,
  paths: Paths,
): Promise<AuthResult | JibError> {
  const source = githubGetSource(cfg, sourceName)
  if (!source) {
    return new NotFoundError(`source "${sourceName}" not found in config`)
  }
  if (source.type === 'key') {
    return { sshKeyPath: githubDeployKeyPaths(paths, sourceName).privateKey }
  }
  if (!source.app_id) {
    return new ValidationError(`source "${sourceName}" missing app_id`)
  }

  const pemPath = githubAuthPemPath(paths, sourceName)
  let pem: string
  try {
    pem = await readFile(pemPath, 'utf8')
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return new InternalError(`read ${pemPath}: ${message}`, { cause: error })
  }

  const org = app.repo.split('/')[0] ?? ''
  if (!org) {
    return new ValidationError(`invalid repo "${app.repo}"`)
  }
  const installationId = await githubInstallationFindForOrg(source.app_id, pem, org)
  if (installationId instanceof Error) {
    return installationId
  }
  const installationToken = await githubJwtGenerateInstallationToken(
    source.app_id,
    pem,
    installationId,
  )
  if (installationToken instanceof Error) {
    return installationToken
  }
  return { token: installationToken.token }
}

/** Applies an auth result to a checkout before subsequent git operations. */
export async function githubAuthApply(
  auth: AuthResult,
  repoDir: string,
  repo: string,
): Promise<JibError | undefined> {
  if (auth.token) {
    return githubRemoteSetToken(repoDir, repo, auth.token)
  }
}
