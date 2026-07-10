import type { Config } from '@jib/config'
import type { Paths } from '@jib/paths'
import { cloudflaredHasTunnelToken } from './service.ts'

export interface CloudflaredStatus {
  configured: boolean
  enabled: boolean
  hasToken: boolean
}

/** Reads Cloudflare readiness from desired module enablement and managed token presence. */
export function cloudflaredReadStatus(config: Config, paths: Paths): CloudflaredStatus {
  const enabled = config.modules.cloudflared === true
  const hasToken = cloudflaredHasTunnelToken(paths)
  return { configured: enabled && hasToken, enabled, hasToken }
}
