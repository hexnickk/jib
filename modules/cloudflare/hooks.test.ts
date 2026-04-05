import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import type { Config } from '@jib/config'
import { type ModuleContext, createLogger, credsPath, getPaths } from '@jib/core'
import type { CloudflareClient, IngressRule } from './client.ts'
import { setClientFactory, setupHooks } from './hooks.ts'
import { mergeAddRoutes, mergeRemoveRoutes } from './routes.ts'

type Calls = {
  findZone: string[]
  created: Array<{ zoneId: string; name: string }>
  deleted: Array<{ zoneId: string; id: string }>
  putIngress: IngressRule[][]
}

function makeFake(existing: IngressRule[] = []): { client: CloudflareClient; calls: Calls } {
  const calls: Calls = { findZone: [], created: [], deleted: [], putIngress: [] }
  const fake = {
    findZoneId: async (d: string) => {
      calls.findZone.push(d)
      return 'zoneX'
    },
    createDNSRecord: async (zoneId: string, r: { name: string }) => {
      calls.created.push({ zoneId, name: r.name })
      return r
    },
    listDNSRecords: async (_zoneId: string, name: string) => [{ id: `id-${name}`, name }],
    deleteDNSRecord: async (zoneId: string, id: string) => {
      calls.deleted.push({ zoneId, id })
    },
    getTunnelIngress: async () => existing,
    putTunnelIngress: async (_a: string, _t: string, rules: IngressRule[]) => {
      calls.putIngress.push(rules)
    },
  }
  return { client: fake as unknown as CloudflareClient, calls }
}

function makeConfig(): Config {
  return {
    config_version: 3,
    poll_interval: '5m',
    tunnel: { provider: 'cloudflare', tunnel_id: 'tun1', account_id: 'acct1' },
    apps: {
      web: {
        repo: 'acme/web',
        branch: 'main',
        env_file: '.env',
        domains: [
          { host: 'api.example.com', port: 8080, ingress: 'cloudflare-tunnel' },
          { host: 'direct.example.com', port: 9090, ingress: 'direct' },
        ],
      },
    },
  }
}

let tmpRoot: string

beforeEach(async () => {
  tmpRoot = await mkdtemp(join(tmpdir(), 'jib-cf-'))
})

afterEach(async () => {
  setClientFactory(null)
  await rm(tmpRoot, { recursive: true, force: true })
})

async function writeToken(): Promise<void> {
  const p = credsPath(getPaths(tmpRoot), 'cloudflare', 'api-token')
  await mkdir(dirname(p), { recursive: true })
  await writeFile(p, 'tkn', { mode: 0o600 })
}

function makeCtx(cfg: Config): ModuleContext<Config> {
  return { config: cfg, logger: createLogger('cf-test'), paths: getPaths(tmpRoot) }
}

describe('route merging', () => {
  test('mergeAddRoutes appends domain + wildcard and keeps catch-all last', () => {
    const out = mergeAddRoutes([{ service: 'http_status:404' }], ['example.com'])
    expect(out[out.length - 1]).toEqual({ service: 'http_status:404' })
    expect(out).toEqual(
      expect.arrayContaining([
        { hostname: 'example.com', service: 'http://localhost:80' },
        { hostname: '*.example.com', service: 'http://localhost:80' },
      ]),
    )
  })

  test('mergeAddRoutes replaces existing rules for same hostnames', () => {
    const existing: IngressRule[] = [
      { hostname: 'example.com', service: 'http://old:80' },
      { service: 'http_status:404' },
    ]
    const out = mergeAddRoutes(existing, ['example.com'])
    const ex = out.find((r) => r.hostname === 'example.com')
    expect(ex?.service).toBe('http://localhost:80')
  })

  test('mergeRemoveRoutes drops domain pair and preserves catch-all', () => {
    const existing: IngressRule[] = [
      { hostname: 'keep.com', service: 'http://localhost:80' },
      { hostname: 'example.com', service: 'http://localhost:80' },
      { hostname: '*.example.com', service: 'http://localhost:80' },
      { service: 'http_status:404' },
    ]
    const out = mergeRemoveRoutes(existing, ['example.com'])
    expect(out.map((r) => r.hostname ?? r.service)).toEqual(['keep.com', 'http_status:404'])
  })
})

describe('cloudflare setupHooks', () => {
  test('onAppAdd filters non-tunnel domains and updates ingress', async () => {
    const { client, calls } = makeFake([{ service: 'http_status:404' }])
    setClientFactory(() => client)
    await writeToken()
    await setupHooks.onAppAdd?.(makeCtx(makeConfig()), 'web')

    expect(calls.findZone).toEqual(['api.example.com'])
    expect(calls.created.map((c) => c.name)).toEqual(['api.example.com', '*.api.example.com'])
    expect(calls.putIngress).toHaveLength(1)
    const rules = calls.putIngress[0] ?? []
    expect(rules.some((r) => r.hostname === 'api.example.com')).toBe(true)
  })

  test('onAppRemove deletes DNS records and rewrites ingress', async () => {
    const { client, calls } = makeFake([
      { hostname: 'api.example.com', service: 'http://localhost:80' },
      { service: 'http_status:404' },
    ])
    setClientFactory(() => client)
    await writeToken()
    await setupHooks.onAppRemove?.(makeCtx(makeConfig()), 'web')

    expect(calls.deleted.length).toBeGreaterThan(0)
    expect(calls.putIngress[0]?.some((r) => r.hostname === 'api.example.com')).toBe(false)
  })

  test('no tunnel domains means no API calls', async () => {
    const { client, calls } = makeFake()
    setClientFactory(() => client)
    await writeToken()
    const cfg = makeConfig()
    const web = cfg.apps.web
    if (!web) throw new Error('fixture missing web app')
    web.domains = [{ host: 'only.example.com', port: 80, ingress: 'direct' }]
    await setupHooks.onAppAdd?.(makeCtx(cfg), 'web')
    expect(calls.findZone).toEqual([])
    expect(calls.putIngress).toEqual([])
  })

  test('missing token → hook logs and returns without calling API', async () => {
    const { client, calls } = makeFake()
    setClientFactory(() => client)
    // no writeToken
    await setupHooks.onAppAdd?.(makeCtx(makeConfig()), 'web')
    expect(calls.putIngress).toEqual([])
  })

  test('missing tunnel config → onAppAdd logs and returns', async () => {
    const { client, calls } = makeFake()
    setClientFactory(() => client)
    await writeToken()
    const cfg = makeConfig()
    cfg.tunnel = undefined
    await setupHooks.onAppAdd?.(makeCtx(cfg), 'web')
    expect(calls.putIngress).toEqual([])
  })
})
