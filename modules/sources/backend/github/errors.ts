import { JibError } from '@jib/errors'

function githubErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function githubErrorOptions(error: unknown): ErrorOptions | undefined {
  return error === undefined ? undefined : { cause: error }
}

export class GitHubAuthSourceNotFoundError extends JibError {
  constructor(sourceName: string) {
    super('github.auth_source_not_found', `source "${sourceName}" not found in config`)
  }
}

export class GitHubAuthMissingAppIdError extends JibError {
  constructor(sourceName: string) {
    super('github.auth_missing_app_id', `source "${sourceName}" missing app_id`)
  }
}

export class GitHubAuthInvalidRepoError extends JibError {
  constructor(repo: string) {
    super('github.auth_invalid_repo', `invalid repo "${repo}"`)
  }
}

export class GitHubAuthReadPemError extends JibError {
  constructor(path: string, error: unknown) {
    super(
      'github.auth_read_pem',
      `read ${path}: ${githubErrorMessage(error)}`,
      githubErrorOptions(error),
    )
  }
}

export class GitHubJwtSignError extends JibError {
  constructor(error: unknown) {
    super('github.jwt_sign', `signing JWT: ${githubErrorMessage(error)}`, githubErrorOptions(error))
  }
}

export class GitHubJwtCreateAccessTokenError extends JibError {
  constructor(status: number, body: string) {
    super('github.jwt_create_access_token', `creating access token: HTTP ${status}: ${body}`)
  }
}

export class GitHubJwtMissingTokenError extends JibError {
  constructor() {
    super('github.jwt_missing_token', 'GitHub returned no token')
  }
}

export class GitHubInstallationListError extends JibError {
  constructor(status: number, body: string) {
    super('github.installation_list', `listing installations: HTTP ${status}: ${body}`)
  }
}

export class GitHubInstallationNotFoundError extends JibError {
  constructor(org: string) {
    super('github.installation_not_found', `no installation found for org "${org}"`)
  }
}

export class GitHubRemoteSetTokenError extends JibError {
  constructor(error: unknown) {
    super(
      'github.remote_set_token',
      `git remote set-url: ${githubErrorMessage(error)}`,
      githubErrorOptions(error),
    )
  }
}

export class GitHubDeployKeyExistsError extends JibError {
  constructor(path: string) {
    super('github.deploy_key_exists', `deploy key already exists at ${path}`)
  }
}

export class GitHubDeployKeyGenerateError extends JibError {
  constructor(message: string, error?: unknown) {
    super('github.deploy_key_generate', message, githubErrorOptions(error))
  }
}

export class GitHubKeyFingerprintError extends JibError {
  constructor(error: unknown) {
    super(
      'github.key_fingerprint',
      `ssh-keygen -l failed: ${githubErrorMessage(error)}`,
      githubErrorOptions(error),
    )
  }
}
