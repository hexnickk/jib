import type { Config } from '@jib/config'

export interface CloudflaredStatus {
  configured: boolean
  accountId: string | null
  tunnelId: string | null
}

export function getCloudflaredStatus(config: Config): CloudflaredStatus {
  if (!config.tunnel || config.tunnel.provider !== 'cloudflare') {
    return { configured: false, tunnelId: null, accountId: null }
  }

  return {
    configured: true,
    tunnelId: config.tunnel.tunnel_id ?? null,
    accountId: config.tunnel.account_id ?? null,
  }
}
