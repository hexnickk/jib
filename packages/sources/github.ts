import { applyAuth, httpsCloneURL, refreshAuth, sshCloneURL } from '@jib-module/github'
import type { App, Config } from '@jib/config'
import type { Paths } from '@jib/core'
import { isExternalRepoURL } from '@jib/core'
import { type GitEnv, configureSSHKey } from './git.ts'

export function cloneURL(app: App, cfg: Config): string {
  if (isExternalRepoURL(app.repo)) return app.repo
  const providerType = app.provider ? cfg.github?.providers?.[app.provider]?.type : undefined
  return providerType === 'key' ? sshCloneURL(app.repo) : httpsCloneURL(app.repo)
}

export async function resolveGitHubSource(
  cfg: Config,
  app: App,
  paths: Paths,
): Promise<{
  applyAuth: (workdir: string) => Promise<void>
  env: GitEnv
  external: boolean
  url: string
}> {
  const external = isExternalRepoURL(app.repo)
  const auth =
    !external && app.provider ? await refreshAuth(app.provider, cfg, app, paths) : undefined
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
