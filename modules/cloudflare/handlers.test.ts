import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import type { Config } from '@jib/config'
import { createLogger, credsPath, getPaths } from '@jib/core'
import { FakeBus, SUBJECTS, flush } from '@jib/rpc'
import type { CloudflareClient, IngressRule } from './client.ts'
import { registerCloudflareHandlers } from './handlers.ts'

type Calls = {
  getIngress: number
  putIngress: IngressRule[][]
  findZone: string[]
  created: Array<{ name: string }>
  listRecords: string[]
  deleted: string[]
}

function fake(
  opts: { existing?: IngressRule[]; createThrows?: boolean; zone?: string | null } = {},
): { client: CloudflareClient; calls: Calls } {
  const calls: Calls = {
    getIngress: 0,
    putIngress: [],
    findZone: [],
    created: [],
    listRecords: [],
    deleted: [],
  }
  const existing = opts.existing ?? [{ service: 'http_status:404' }]
  const zone = opts.zone === undefined ? 'zoneX' : opts.zone
  const client = {
    getTunnelIngress: async () => {
      calls.getIngress += 1
      return existing
    },
    putTunnelIngress: async (_a: string, _t: string, rules: IngressRule[]) => {
      calls.putIngress.push(rules)
    },
    findZoneId: async (d: string) => {
      calls.findZone.push(d)
      return zone
    },
    createDNSRecord: async (_z: string, r: { name: string }) => {
      calls.created.push({ name: r.name })
      if (opts.createThrows) throw new Error('duplicate')
      return r
    },
    listDNSRecords: async (_z: string, name: string) => {
      calls.listRecords.push(name)
      return [{ id: `id-${name}`, name }]
    },
    deleteDNSRecord: async (_z: string, id: string) => {
      calls.deleted.push(id)
    },
  }
  return { client: client as unknown as CloudflareClient, calls }
}

async function waitFor<T>(fn: () => T | undefined, max = 40): Promise<T> {
  for (let i = 0; i < max; i++) {
    const v = fn()
    if (v !== undefined) return v
    await flush()
  }
  throw new Error('timed out')
}

function configWithTunnel(): Config {
  return {
    config_version: 3,
    poll_interval: '5m',
    tunnel: { provider: 'cloudflare', tunnel_id: 'tun1', account_id: 'acct1' },
    apps: {},
  }
}

let tmpRoot: string

beforeEach(async () => {
  tmpRoot = await mkdtemp(join(tmpdir(), 'jib-cf-op-'))
})

afterEach(async () => {
  await rm(tmpRoot, { recursive: true, force: true })
})

async function writeToken(value = 'tkn'): Promise<void> {
  const p = credsPath(getPaths(tmpRoot), 'cloudflare', 'api-token')
  await mkdir(dirname(p), { recursive: true })
  await writeFile(p, value, { mode: 0o600 })
}

function setup(client: CloudflareClient, cfg: Config = configWithTunnel()) {
  const bus = new FakeBus()
  registerCloudflareHandlers(bus.asBus(), {
    paths: getPaths(tmpRoot),
    log: createLogger('cf-test'),
    config: cfg,
    clientFactory: () => client,
  })
  return bus
}

function envelope(rootDomain: string): Record<string, unknown> {
  return {
    corrId: `c-${rootDomain}`,
    ts: new Date().toISOString(),
    source: 'test',
    rootDomain,
  }
}

describe('cloudflare operator handlers', () => {
  test('cmd.cloudflare.domain.add writes apex+wildcard routes + DNS, emits ready', async () => {
    const { client, calls } = fake()
    const bus = setup(client)
    await writeToken()
    const ready: Array<{ rootDomain: string }> = []
    bus.subscribe(SUBJECTS.evt.cloudflareDomainReady, (p) => {
      ready.push(p as { rootDomain: string })
    })
    bus.publish(SUBJECTS.cmd.cloudflareDomainAdd, envelope('example.com'))
    await waitFor(() => (ready.length ? ready : undefined))
    expect(ready[0]?.rootDomain).toBe('example.com')
    // Ingress put once containing both apex + wildcard pointing to localhost:80.
    expect(calls.putIngress).toHaveLength(1)
    const rules = calls.putIngress[0] ?? []
    const hosts = rules.filter((r) => r.hostname !== undefined).map((r) => r.hostname)
    expect(hosts).toContain('example.com')
    expect(hosts).toContain('*.example.com')
    // Catch-all must still be last.
    expect(rules[rules.length - 1]?.service).toBe('http_status:404')
    // DNS: two records created (apex + wildcard).
    expect(calls.created.map((c) => c.name)).toEqual(['example.com', '*.example.com'])
  })

  test('cmd.cloudflare.domain.add is idempotent when createDNSRecord throws', async () => {
    const { client, calls } = fake({ createThrows: true })
    const bus = setup(client)
    await writeToken()
    const ready: unknown[] = []
    bus.subscribe(SUBJECTS.evt.cloudflareDomainReady, (p) => {
      ready.push(p)
    })
    bus.publish(SUBJECTS.cmd.cloudflareDomainAdd, envelope('example.com'))
    await waitFor(() => (ready.length ? ready : undefined))
    // Routes still written even when DNS create failed (treated as duplicate).
    expect(calls.putIngress).toHaveLength(1)
    expect(calls.created).toHaveLength(2)
  })

  test('cmd.cloudflare.domain.add emits progress events during each phase', async () => {
    const { client } = fake()
    const bus = setup(client)
    await writeToken()
    const progress: Array<{ message: string }> = []
    bus.subscribe(SUBJECTS.evt.cloudflareDomainProgress, (p) => {
      progress.push(p as { message: string })
    })
    const ready: unknown[] = []
    bus.subscribe(SUBJECTS.evt.cloudflareDomainReady, (p) => {
      ready.push(p)
    })
    bus.publish(SUBJECTS.cmd.cloudflareDomainAdd, envelope('example.com'))
    await waitFor(() => (ready.length ? ready : undefined))
    expect(progress.length).toBeGreaterThanOrEqual(2)
    expect(progress.some((p) => p.message.includes('ingress'))).toBe(true)
  })

  test('cmd.cloudflare.domain.remove strips routes and deletes DNS records', async () => {
    const existing: IngressRule[] = [
      { hostname: 'keep.com', service: 'http://localhost:80' },
      { hostname: 'example.com', service: 'http://localhost:80' },
      { hostname: '*.example.com', service: 'http://localhost:80' },
      { service: 'http_status:404' },
    ]
    const { client, calls } = fake({ existing })
    const bus = setup(client)
    await writeToken()
    const removed: unknown[] = []
    bus.subscribe(SUBJECTS.evt.cloudflareDomainRemoved, (p) => {
      removed.push(p)
    })
    bus.publish(SUBJECTS.cmd.cloudflareDomainRemove, envelope('example.com'))
    await waitFor(() => (removed.length ? removed : undefined))
    const rules = calls.putIngress[0] ?? []
    expect(rules.some((r) => r.hostname === 'example.com')).toBe(false)
    expect(rules.some((r) => r.hostname === '*.example.com')).toBe(false)
    expect(rules.some((r) => r.hostname === 'keep.com')).toBe(true)
    expect(calls.deleted).toHaveLength(2)
  })

  test('missing token → failure event with clear error', async () => {
    const { client } = fake()
    const bus = setup(client)
    // no writeToken
    const failed: Array<{ error: string }> = []
    bus.subscribe(SUBJECTS.evt.cloudflareDomainFailed, (p) => {
      failed.push(p as { error: string })
    })
    bus.publish(SUBJECTS.cmd.cloudflareDomainAdd, envelope('example.com'))
    await waitFor(() => (failed.length ? failed : undefined))
    expect(failed[0]?.error).toContain('cloudflare API token missing')
  })

  test('missing tunnel config → failure event', async () => {
    const { client } = fake()
    const cfg = configWithTunnel()
    cfg.tunnel = undefined
    const bus = setup(client, cfg)
    await writeToken()
    const failed: Array<{ error: string }> = []
    bus.subscribe(SUBJECTS.evt.cloudflareDomainFailed, (p) => {
      failed.push(p as { error: string })
    })
    bus.publish(SUBJECTS.cmd.cloudflareDomainAdd, envelope('example.com'))
    await waitFor(() => (failed.length ? failed : undefined))
    expect(failed[0]?.error).toContain('tunnel not configured')
  })

  test('add with no cloudflare zone still writes routes (DNS best-effort)', async () => {
    const { client, calls } = fake({ zone: null })
    const bus = setup(client)
    await writeToken()
    const ready: unknown[] = []
    bus.subscribe(SUBJECTS.evt.cloudflareDomainReady, (p) => {
      ready.push(p)
    })
    bus.publish(SUBJECTS.cmd.cloudflareDomainAdd, envelope('example.com'))
    await waitFor(() => (ready.length ? ready : undefined))
    expect(calls.putIngress).toHaveLength(1)
    expect(calls.created).toEqual([])
  })
})
