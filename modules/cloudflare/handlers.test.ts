import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import type { Config } from '@jib/config'
import { createLogger, credsPath, getPaths } from '@jib/core'
import { FakeBus, SUBJECTS, flush } from '@jib/rpc'
import type { CloudflareClient, IngressRule } from './client.ts'
import { registerCloudflareHandlers } from './handlers.ts'

type Calls = { put: IngressRule[][]; created: string[]; deleted: string[] }
type FakeOpts = { existing?: IngressRule[]; createError?: string; zone?: string | null }

function fake(opts: FakeOpts = {}): { client: CloudflareClient; calls: Calls } {
  const calls: Calls = { put: [], created: [], deleted: [] }
  const existing = opts.existing ?? [{ service: 'http_status:404' }]
  const zone = opts.zone === undefined ? 'zoneX' : opts.zone
  const client = {
    getTunnelIngress: async () => existing,
    putTunnelIngress: async (_a: string, _t: string, r: IngressRule[]) => void calls.put.push(r),
    findZoneId: async () => zone,
    createDNSRecord: async (_z: string, r: { name: string }) => {
      calls.created.push(r.name)
      if (opts.createError) throw new Error(opts.createError)
      return r
    },
    listDNSRecords: async (_z: string, name: string) => [{ id: `id-${name}`, name }],
    deleteDNSRecord: async (_z: string, id: string) => void calls.deleted.push(id),
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
afterEach(() => rm(tmpRoot, { recursive: true, force: true }))

async function writeToken(): Promise<void> {
  const p = credsPath(getPaths(tmpRoot), 'cloudflare', 'api-token')
  await mkdir(dirname(p), { recursive: true })
  await writeFile(p, 'tkn', { mode: 0o600 })
}

function setup(client: CloudflareClient, cfg: Config = configWithTunnel()) {
  const bus = new FakeBus()
  registerCloudflareHandlers(bus.asBus(), {
    paths: getPaths(tmpRoot),
    log: createLogger('cf-test'),
    getConfig: () => cfg,
    clientFactory: () => client,
  })
  return bus
}

const env = (rootDomain: string) => ({
  corrId: `c-${rootDomain}`,
  ts: new Date().toISOString(),
  source: 'test',
  rootDomain,
})

async function runAndCollect(
  bus: FakeBus,
  cmd: string,
  terminal: string,
): Promise<Array<Record<string, unknown>>> {
  const events: Array<Record<string, unknown>> = []
  bus.subscribe(terminal, (p) => {
    events.push(p as Record<string, unknown>)
  })
  bus.publish(cmd, env('example.com'))
  return waitFor(() => (events.length ? events : undefined))
}

describe('cloudflare operator handlers', () => {
  test('domain.add writes apex+wildcard routes + DNS, emits ready', async () => {
    const { client, calls } = fake()
    const bus = setup(client)
    await writeToken()
    await runAndCollect(bus, SUBJECTS.cmd.cloudflareDomainAdd, SUBJECTS.evt.cloudflareDomainReady)
    expect(calls.put).toHaveLength(1)
    const rules = calls.put[0] ?? []
    const hosts = rules.filter((r) => r.hostname !== undefined).map((r) => r.hostname)
    expect(hosts).toContain('example.com')
    expect(hosts).toContain('*.example.com')
    expect(rules[rules.length - 1]?.service).toBe('http_status:404')
    expect(calls.created).toEqual(['example.com', '*.example.com'])
  })

  test('domain.add swallows duplicate DNS errors (idempotent)', async () => {
    const { client, calls } = fake({ createError: 'duplicate record' })
    const bus = setup(client)
    await writeToken()
    await runAndCollect(bus, SUBJECTS.cmd.cloudflareDomainAdd, SUBJECTS.evt.cloudflareDomainReady)
    expect(calls.put).toHaveLength(1)
    expect(calls.created).toHaveLength(2)
  })

  test('domain.add surfaces non-duplicate DNS errors as failure', async () => {
    const { client } = fake({ createError: 'Unauthorized (10000)' })
    const bus = setup(client)
    await writeToken()
    const [failed] = await runAndCollect(
      bus,
      SUBJECTS.cmd.cloudflareDomainAdd,
      SUBJECTS.evt.cloudflareDomainFailed,
    )
    expect(String(failed?.error)).toContain('Unauthorized')
  })

  test('domain.add emits progress during each phase', async () => {
    const { client } = fake()
    const bus = setup(client)
    await writeToken()
    const progress: Array<{ message: string }> = []
    bus.subscribe(SUBJECTS.evt.cloudflareDomainProgress, (p) => {
      progress.push(p as { message: string })
    })
    await runAndCollect(bus, SUBJECTS.cmd.cloudflareDomainAdd, SUBJECTS.evt.cloudflareDomainReady)
    expect(progress.length).toBeGreaterThanOrEqual(2)
    expect(progress.some((p) => p.message.includes('ingress'))).toBe(true)
  })

  test('domain.remove strips routes and deletes DNS records', async () => {
    const existing: IngressRule[] = [
      { hostname: 'keep.com', service: 'http://localhost:80' },
      { hostname: 'example.com', service: 'http://localhost:80' },
      { hostname: '*.example.com', service: 'http://localhost:80' },
      { service: 'http_status:404' },
    ]
    const { client, calls } = fake({ existing })
    const bus = setup(client)
    await writeToken()
    await runAndCollect(
      bus,
      SUBJECTS.cmd.cloudflareDomainRemove,
      SUBJECTS.evt.cloudflareDomainRemoved,
    )
    const rules = calls.put[0] ?? []
    expect(rules.some((r) => r.hostname === 'example.com')).toBe(false)
    expect(rules.some((r) => r.hostname === '*.example.com')).toBe(false)
    expect(rules.some((r) => r.hostname === 'keep.com')).toBe(true)
    expect(calls.deleted).toHaveLength(2)
  })

  test('missing token → failure event with clear error', async () => {
    const { client } = fake()
    const bus = setup(client)
    const [failed] = await runAndCollect(
      bus,
      SUBJECTS.cmd.cloudflareDomainAdd,
      SUBJECTS.evt.cloudflareDomainFailed,
    )
    expect(String(failed?.error)).toContain('cloudflare API token missing')
  })

  test('missing tunnel config → failure event', async () => {
    const { client } = fake()
    const cfg = configWithTunnel()
    cfg.tunnel = undefined
    const bus = setup(client, cfg)
    await writeToken()
    const [failed] = await runAndCollect(
      bus,
      SUBJECTS.cmd.cloudflareDomainAdd,
      SUBJECTS.evt.cloudflareDomainFailed,
    )
    expect(String(failed?.error)).toContain('tunnel not configured')
  })

  test('add with no cloudflare zone still writes routes (DNS best-effort)', async () => {
    const { client, calls } = fake({ zone: null })
    const bus = setup(client)
    await writeToken()
    await runAndCollect(bus, SUBJECTS.cmd.cloudflareDomainAdd, SUBJECTS.evt.cloudflareDomainReady)
    expect(calls.put).toHaveLength(1)
    expect(calls.created).toEqual([])
  })
})
