import type { App, Config, Source } from '@jib/config'
import type { Paths } from '@jib/paths'
import { isExternalRepoURL, pathExists } from '@jib/paths'
import { configureSSHKey } from '../../git.ts'
import type { DriverSourceStatus, ResolvedDriverSource, SourceDriver } from '../../types.ts'
import { appPemPath, applyAuth, refreshAuth } from './auth.ts'
import { deployKeyPaths } from './keygen.ts'
import { httpsCloneURL, sshCloneURL } from './remote-url.ts'
import { githubSetup } from './setup.ts'

const AUTH_FAILURE_SNIPPETS = [
  'Permission denied (publickey)',
  'Could not read from remote repository',
  'Authentication failed',
  'Repository not found',
  'could not read Username',
  'not found in config',
]

export function githubCloneUrl(app: App, cfg: Config): string {
  if (isExternalRepoURL(app.repo)) return app.repo
  const sourceType = app.source ? cfg.sources[app.source]?.type : undefined
  return sourceType === 'key' ? sshCloneURL(app.repo) : httpsCloneURL(app.repo)
}

export async function githubResolveSource(
  cfg: Config,
  app: App,
  paths: Paths,
): Promise<ResolvedDriverSource> {
  const external = isExternalRepoURL(app.repo)
  const auth = !external && app.source ? await refreshAuth(app.source, cfg, app, paths) : undefined
  const env = auth?.sshKeyPath ? configureSSHKey(auth.sshKeyPath) : {}
  const url =
    auth?.token && !external ? httpsCloneURL(app.repo, auth.token) : githubCloneUrl(app, cfg)

  return {
    applyAuth: external
      ? async () => {}
      : async (workdir: string) => {
          if (auth) await applyAuth(auth, workdir, app.repo)
        },
    env,
    url,
  }
}

function supportsGitHubRepo(repo: string): boolean {
  return repo !== 'local' && !isExternalRepoURL(repo)
}

function isGitHubAuthFailure(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error)
  return AUTH_FAILURE_SNIPPETS.some((snippet) => message.includes(snippet))
}

function describeGitHubSource(source: Source): string {
  return source.type === 'app' ? 'GitHub App' : 'GitHub deployment key'
}

async function describeGitHubStatus(
  sourceName: string,
  source: Source,
  paths: Paths,
): Promise<DriverSourceStatus> {
  const credentialPath =
    source.type === 'app'
      ? appPemPath(paths, sourceName)
      : deployKeyPaths(paths, sourceName).privateKey
  return {
    detail: source.type === 'app' ? `github app (id ${source.app_id})` : 'github deploy-key',
    hasCredential: await pathExists(credentialPath),
  }
}

export const githubDriver: SourceDriver = {
  name: 'github',
  setupLabel: 'GitHub source',
  setup: githubSetup,
  resolve: githubResolveSource,
  supportsRepo: supportsGitHubRepo,
  isAuthFailure: isGitHubAuthFailure,
  describe: describeGitHubSource,
  describeStatus: describeGitHubStatus,
}
