import type { App, Config, Source } from '@jib/config'
import type { Paths } from '@jib/paths'
import { isExternalRepoURL, pathExists } from '@jib/paths'
import { sourcesGitConfigureSshKey } from '../../git.ts'
import type { DriverSourceStatus, ResolvedDriverSource, SourceDriver } from '../../types.ts'
import { githubAuthApply, githubAuthPemPath, githubAuthRefresh } from './auth.ts'
import { githubDeployKeyPaths } from './keygen.ts'
import { githubRemoteHttpsCloneUrl, githubRemoteSshCloneUrl } from './remote-url.ts'
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
  return sourceType === 'key'
    ? githubRemoteSshCloneUrl(app.repo)
    : githubRemoteHttpsCloneUrl(app.repo)
}

export async function githubResolveSource(
  cfg: Config,
  app: App,
  paths: Paths,
): Promise<ResolvedDriverSource | Error> {
  const external = isExternalRepoURL(app.repo)
  const auth =
    !external && app.source ? await githubAuthRefresh(app.source, cfg, app, paths) : undefined
  if (auth instanceof Error) return auth
  const env = auth?.sshKeyPath ? sourcesGitConfigureSshKey(auth.sshKeyPath) : {}
  const url =
    auth?.token && !external
      ? githubRemoteHttpsCloneUrl(app.repo, auth.token)
      : githubCloneUrl(app, cfg)

  return {
    applyAuth: external
      ? async () => undefined
      : async (workdir: string) => (auth ? githubAuthApply(auth, workdir, app.repo) : undefined),
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
      ? githubAuthPemPath(paths, sourceName)
      : githubDeployKeyPaths(paths, sourceName).privateKey
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
