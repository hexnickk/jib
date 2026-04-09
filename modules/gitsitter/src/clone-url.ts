import { httpsCloneURL, sshCloneURL } from '@jib-module/github'
import type { App, Config } from '@jib/config'
import { isExternalRepoURL } from '@jib/core'

/**
 * Resolves the clone URL for an app. External URLs pass through verbatim.
 * Anonymous GitHub slug clones use HTTPS, GitHub App providers use HTTPS,
 * and deploy-key providers use SSH.
 */
export function cloneURL(app: App, cfg: Config): string {
  if (isExternalRepoURL(app.repo)) return app.repo
  const providerType = app.provider ? cfg.github?.providers?.[app.provider]?.type : undefined
  return providerType === 'key' ? sshCloneURL(app.repo) : httpsCloneURL(app.repo)
}
