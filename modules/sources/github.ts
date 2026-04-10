import { applyAuth, httpsCloneURL, refreshAuth, sshCloneURL } from '@jib-module/github'
import type { App, Config } from '@jib/config'
import type { Paths } from '@jib/core'
import { isExternalRepoURL } from '@jib/core'
import { configureSSHKey } from './git.ts'
import type { ResolvedDriverSource, SourceDriver } from './types.ts'

export function cloneURL(app: App, cfg: Config): string {
  if (isExternalRepoURL(app.repo)) return app.repo
  const sourceType = app.source ? cfg.sources[app.source]?.type : undefined
  return sourceType === 'key' ? sshCloneURL(app.repo) : httpsCloneURL(app.repo)
}

export async function resolveGitHubSource(
  cfg: Config,
  app: App,
  paths: Paths,
): Promise<ResolvedDriverSource> {
  const external = isExternalRepoURL(app.repo)
  const auth = !external && app.source ? await refreshAuth(app.source, cfg, app, paths) : undefined
  const env = auth?.sshKeyPath ? configureSSHKey(auth.sshKeyPath) : {}
  const url = auth?.token && !external ? httpsCloneURL(app.repo, auth.token) : cloneURL(app, cfg)

  return {
    applyAuth: external
      ? async () => {}
      : async (workdir: string) => {
          if (auth) await applyAuth(auth, workdir, app.repo)
        },
    env,
    external,
    url,
  }
}

export const githubDriver: SourceDriver = {
  name: 'github',
  resolve: resolveGitHubSource,
}
