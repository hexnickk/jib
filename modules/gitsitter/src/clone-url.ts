import { httpsCloneURL, sshCloneURL } from '@jib-module/github'
import type { App, Config } from '@jib/config'
import { isExternalRepoURL } from '@jib/core'

/**
 * Resolves the clone URL for an app. External URLs pass through verbatim.
 * GitHub App providers use HTTPS; deploy-key providers use SSH.
 */
export function cloneURL(app: App, cfg: Config): string {
  if (isExternalRepoURL(app.repo)) return app.repo
  const providerType = app.provider ? cfg.github?.providers?.[app.provider]?.type : undefined
  return providerType === 'app' ? httpsCloneURL(app.repo) : sshCloneURL(app.repo)
}
