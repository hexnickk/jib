import { readFile } from 'node:fs/promises'
import type { Config } from '@jib/config'
import { type ModuleContext, type SetupHook, credsPath } from '@jib/core'
import { CloudflareClient } from './client.ts'
import { addTunnelRoutes, removeTunnelRoutes } from './routes.ts'

type Ctx = ModuleContext<Config>

/**
 * Factory pulled out so tests can inject a fake `CloudflareClient`. In
 * production the API token is read from the secrets file on disk.
 */
export type ClientFactory = (token: string) => CloudflareClient
let makeClient: ClientFactory = (token) => new CloudflareClient({ token })

export function setClientFactory(fn: ClientFactory | null): void {
  makeClient = fn ?? ((t) => new CloudflareClient({ token: t }))
}

export function tokenPath(ctx: Ctx): string {
  return credsPath(ctx.paths, 'cloudflare', 'api-token')
}

async function loadToken(ctx: Ctx): Promise<string | null> {
  try {
    const raw = await readFile(tokenPath(ctx), 'utf8')
    return raw.trim() || null
  } catch {
    return null
  }
}

function tunnelDomains(ctx: Ctx, app: string): string[] {
  const a = ctx.config.apps[app]
  if (!a) return []
  return a.domains.filter((d) => d.ingress === 'cloudflare-tunnel').map((d) => d.host)
}

function tunnelIds(ctx: Ctx): { tunnelId: string; accountId: string } | null {
  const t = ctx.config.tunnel
  if (!t || !t.tunnel_id || !t.account_id) return null
  return { tunnelId: t.tunnel_id, accountId: t.account_id }
}

export const setupHooks: SetupHook<Config> = {
  async onAppAdd(ctx, app) {
    const c = ctx as Ctx
    const domains = tunnelDomains(c, app)
    if (domains.length === 0) return
    const ids = tunnelIds(c)
    if (!ids) {
      c.logger.warn('cloudflare tunnel not configured — run `jib cloudflare setup`')
      return
    }
    const token = await loadToken(c)
    if (!token) {
      c.logger.warn(`cloudflare API token missing at ${tokenPath(c)}`)
      return
    }
    const client = makeClient(token)
    await addTunnelRoutes(client, ids.accountId, ids.tunnelId, domains, c.logger)
  },
  async onAppRemove(ctx, app) {
    const c = ctx as Ctx
    const domains = tunnelDomains(c, app)
    if (domains.length === 0) return
    const ids = tunnelIds(c)
    if (!ids) return
    const token = await loadToken(c)
    if (!token) return
    const client = makeClient(token)
    await removeTunnelRoutes(client, ids.accountId, ids.tunnelId, domains, c.logger)
  },
}
