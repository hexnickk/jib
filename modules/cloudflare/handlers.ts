import { readFile } from 'node:fs/promises'
import type { Bus } from '@jib/bus'
import type { Config } from '@jib/config'
import { type Logger, type Paths, credsPath } from '@jib/core'
import { SUBJECTS, handleCmd } from '@jib/rpc'
import { CloudflareClient, type IngressRule } from './client.ts'

/**
 * Handlers for `cmd.cloudflare.domain.{add,remove}`. The cloudflare operator
 * no longer does per-app work: its sole job is to plumb a root domain onto
 * the box by adding apex + wildcard ingress routes and matching DNS records.
 * After first setup the operator is effectively idle.
 *
 * `CloudflareClient` is injected via a factory so tests can supply a
 * recording fake; production reads the API token from the secrets file.
 */
export type ClientFactory = (token: string) => CloudflareClient
export const defaultClientFactory: ClientFactory = (t) => new CloudflareClient({ token: t })

export interface CloudflareOperatorDeps {
  paths: Paths
  log: Logger
  /** Resolved per command so each invocation sees the latest config.yml. */
  getConfig: () => Promise<Config> | Config
  clientFactory?: ClientFactory
}

const PROXY_TARGET = 'http://localhost:80'
const CATCH_ALL: IngressRule = { service: 'http_status:404' }

async function loadToken(paths: Paths): Promise<string> {
  const p = credsPath(paths, 'cloudflare', 'api-token')
  try {
    const raw = await readFile(p, 'utf8')
    const t = raw.trim()
    if (!t) throw new Error('empty token file')
    return t
  } catch (err) {
    throw new Error(`cloudflare API token missing at ${p}: ${(err as Error).message}`)
  }
}

function tunnelIds(config: Config): { accountId: string; tunnelId: string } {
  const t = config.tunnel
  if (!t || !t.tunnel_id || !t.account_id) {
    throw new Error('cloudflare tunnel not configured — run `jib cloudflare setup`')
  }
  return { accountId: t.account_id, tunnelId: t.tunnel_id }
}

/** Build a fresh ingress list keeping everything unrelated + adding/removing the pair. */
function mergeRoutes(
  existing: IngressRule[],
  rootDomain: string,
  mode: 'add' | 'remove',
): IngressRule[] {
  const pair = [rootDomain, `*.${rootDomain}`]
  const kept = existing.filter(
    (r) =>
      r.service !== CATCH_ALL.service && (r.hostname === undefined || !pair.includes(r.hostname)),
  )
  if (mode === 'remove') return [...kept, CATCH_ALL]
  return [...kept, ...pair.map((h) => ({ hostname: h, service: PROXY_TARGET })), CATCH_ALL]
}

async function applyRoutes(
  client: CloudflareClient,
  accountId: string,
  tunnelId: string,
  rootDomain: string,
  mode: 'add' | 'remove',
): Promise<void> {
  const existing = await client.getTunnelIngress(accountId, tunnelId)
  await client.putTunnelIngress(accountId, tunnelId, mergeRoutes(existing, rootDomain, mode))
}

/** Idempotent DNS reconcile: adds apex+wildcard CNAMEs, or removes them. */
async function applyDNS(
  client: CloudflareClient,
  tunnelId: string,
  rootDomain: string,
  mode: 'add' | 'remove',
  log: Logger,
): Promise<void> {
  const zoneId = await client.findZoneId(rootDomain).catch(() => null)
  if (!zoneId) {
    if (mode === 'add') log.warn(`no cloudflare zone for ${rootDomain} — add DNS manually`)
    return
  }
  const cname = `${tunnelId}.cfargotunnel.com`
  for (const name of [rootDomain, `*.${rootDomain}`]) {
    if (mode === 'add') {
      try {
        await client.createDNSRecord(zoneId, { type: 'CNAME', name, content: cname, proxied: true })
        log.info(`dns: ${rootDomain} CNAME ${name} -> ${cname}`)
      } catch (e) {
        // Cloudflare returns an error on duplicate record names. We only want
        // to swallow that specific case so `add` stays idempotent; everything
        // else (auth, quota, bad zone) must still surface.
        const msg = (e as Error).message
        if (!/already exists|identical record|duplicate|81053|81057/i.test(msg)) throw e
        log.info(`dns: ${rootDomain} CNAME ${name} already present`)
      }
    } else {
      const records = await client.listDNSRecords(zoneId, name).catch(() => [])
      for (const r of records) {
        if (!r.id) continue
        await client.deleteDNSRecord(zoneId, r.id).catch(() => undefined)
        log.info(`dns: removed ${name}`)
      }
    }
  }
}

async function runDomainOp(
  deps: CloudflareOperatorDeps,
  rootDomain: string,
  mode: 'add' | 'remove',
  emitProgress: ((p: { rootDomain: string; message: string }) => void) | undefined,
): Promise<void> {
  const factory = deps.clientFactory ?? defaultClientFactory
  emitProgress?.({ rootDomain, message: 'loading token + tunnel config' })
  const token = await loadToken(deps.paths)
  const config = await deps.getConfig()
  const { accountId, tunnelId } = tunnelIds(config)
  const client = factory(token)
  emitProgress?.({
    rootDomain,
    message: `${mode === 'add' ? 'writing' : 'removing'} tunnel ingress routes`,
  })
  await applyRoutes(client, accountId, tunnelId, rootDomain, mode)
  emitProgress?.({ rootDomain, message: `${mode === 'add' ? 'ensuring' : 'removing'} DNS records` })
  await applyDNS(client, tunnelId, rootDomain, mode, deps.log)
}

export function registerCloudflareHandlers(bus: Bus, deps: CloudflareOperatorDeps): () => void {
  const log = deps.log
  const addSub = handleCmd(
    bus,
    SUBJECTS.cmd.cloudflareDomainAdd,
    'cloudflare',
    'cloudflare',
    SUBJECTS.evt.cloudflareDomainProgress,
    SUBJECTS.evt.cloudflareDomainFailed,
    async (cmd, ctx) => {
      try {
        await runDomainOp(deps, cmd.rootDomain, 'add', ctx.emitProgress)
        log.info(`cloudflare domain ready: ${cmd.rootDomain}`)
        return {
          success: {
            subject: SUBJECTS.evt.cloudflareDomainReady,
            body: { rootDomain: cmd.rootDomain },
          },
        }
      } catch (err) {
        const error = err instanceof Error ? err.message : String(err)
        log.warn(`cloudflare domain add failed for ${cmd.rootDomain}: ${error}`)
        return {
          failure: {
            subject: SUBJECTS.evt.cloudflareDomainFailed,
            body: { rootDomain: cmd.rootDomain, error },
          },
        }
      }
    },
  )
  const removeSub = handleCmd(
    bus,
    SUBJECTS.cmd.cloudflareDomainRemove,
    'cloudflare',
    'cloudflare',
    SUBJECTS.evt.cloudflareDomainProgress,
    SUBJECTS.evt.cloudflareDomainFailed,
    async (cmd, ctx) => {
      try {
        await runDomainOp(deps, cmd.rootDomain, 'remove', ctx.emitProgress)
        log.info(`cloudflare domain removed: ${cmd.rootDomain}`)
        return {
          success: {
            subject: SUBJECTS.evt.cloudflareDomainRemoved,
            body: { rootDomain: cmd.rootDomain },
          },
        }
      } catch (err) {
        const error = err instanceof Error ? err.message : String(err)
        log.warn(`cloudflare domain remove failed for ${cmd.rootDomain}: ${error}`)
        return {
          failure: {
            subject: SUBJECTS.evt.cloudflareDomainFailed,
            body: { rootDomain: cmd.rootDomain, error },
          },
        }
      }
    },
  )
  return () => {
    addSub.unsubscribe()
    removeSub.unsubscribe()
  }
}
