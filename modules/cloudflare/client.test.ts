import { describe, expect, test } from 'bun:test'
import { CloudflareClient, type FetchFn, baseDomain } from './client.ts'

type Call = { url: string; method: string; body?: unknown; headers: Record<string, string> }

function makeFetch(responder: (call: Call) => Response): {
  fn: FetchFn
  calls: Call[]
} {
  const calls: Call[] = []
  const fn: FetchFn = async (input, init) => {
    const headers: Record<string, string> = {}
    const h = init?.headers as Record<string, string> | undefined
    if (h) for (const k in h) headers[k.toLowerCase()] = h[k] ?? ''
    const call: Call = {
      url: typeof input === 'string' ? input : (input as URL).toString(),
      method: init?.method ?? 'GET',
      body: init?.body ? JSON.parse(init.body as string) : undefined,
      headers,
    }
    calls.push(call)
    return responder(call)
  }
  return { fn, calls }
}

function ok<T>(result: T): Response {
  return new Response(JSON.stringify({ success: true, errors: [], result }), { status: 200 })
}
function err(code: number, message: string): Response {
  return new Response(JSON.stringify({ success: false, errors: [{ code, message }] }), {
    status: 400,
  })
}

describe('baseDomain', () => {
  test('reduces multi-label hostnames to last two labels', () => {
    expect(baseDomain('api.example.com')).toBe('example.com')
    expect(baseDomain('a.b.c.example.com')).toBe('example.com')
  })
  test('leaves two-label hostnames unchanged', () => {
    expect(baseDomain('example.com')).toBe('example.com')
    expect(baseDomain('localhost')).toBe('localhost')
  })
})

describe('CloudflareClient', () => {
  test('verifyToken hits /user/tokens/verify then /accounts and returns accountId', async () => {
    const { fn, calls } = makeFetch((c) => {
      if (c.url.endsWith('/user/tokens/verify')) return ok({ status: 'active' })
      if (c.url.includes('/accounts')) return ok([{ id: 'acct_123', name: 'root' }])
      return err(0, 'unexpected')
    })
    const client = new CloudflareClient({ token: 'tkn', fetchFn: fn })
    const res = await client.verifyToken()
    expect(res.accountId).toBe('acct_123')
    expect(calls[0]?.headers.authorization).toBe('Bearer tkn')
    expect(calls[0]?.method).toBe('GET')
    expect(calls[1]?.url).toContain('per_page=1')
  })

  test('verifyToken throws when status is not active', async () => {
    const { fn } = makeFetch(() => ok({ status: 'disabled' }))
    const client = new CloudflareClient({ token: 'x', fetchFn: fn })
    await expect(client.verifyToken()).rejects.toThrow(/disabled/)
  })

  test('createTunnel POSTs with name + tunnel_secret', async () => {
    const { fn, calls } = makeFetch(() => ok({ id: 't1', name: 'foo' }))
    const client = new CloudflareClient({ token: 'x', fetchFn: fn })
    const t = await client.createTunnel('acct', 'foo', 'secret==')
    expect(t.id).toBe('t1')
    expect(calls[0]?.method).toBe('POST')
    expect(calls[0]?.body).toEqual({
      name: 'foo',
      tunnel_secret: 'secret==',
      config_src: 'cloudflare',
    })
  })

  test('getTunnelIngress unwraps config.ingress shape', async () => {
    const { fn } = makeFetch(() =>
      ok({ config: { ingress: [{ hostname: 'a.example.com', service: 'http://localhost:80' }] } }),
    )
    const client = new CloudflareClient({ token: 'x', fetchFn: fn })
    const rules = await client.getTunnelIngress('acct', 't1')
    expect(rules).toHaveLength(1)
    expect(rules[0]?.hostname).toBe('a.example.com')
  })

  test('getTunnelIngress defaults to [] when config missing', async () => {
    const { fn } = makeFetch(() => ok({}))
    const client = new CloudflareClient({ token: 'x', fetchFn: fn })
    expect(await client.getTunnelIngress('acct', 't1')).toEqual([])
  })

  test('putTunnelIngress sends {config:{ingress}} body', async () => {
    const { fn, calls } = makeFetch(() => ok({}))
    const client = new CloudflareClient({ token: 'x', fetchFn: fn })
    await client.putTunnelIngress('acct', 't1', [{ service: 'http_status:404' }])
    expect(calls[0]?.method).toBe('PUT')
    expect(calls[0]?.body).toEqual({ config: { ingress: [{ service: 'http_status:404' }] } })
  })

  test('getTunnelToken parses raw-string response (not enveloped)', async () => {
    const { fn } = makeFetch(() => new Response(JSON.stringify('raw-token-value'), { status: 200 }))
    const client = new CloudflareClient({ token: 'x', fetchFn: fn })
    expect(await client.getTunnelToken('acct', 't1')).toBe('raw-token-value')
  })

  test('findZoneId returns first match', async () => {
    const { fn, calls } = makeFetch(() => ok([{ id: 'zone1', name: 'example.com' }]))
    const client = new CloudflareClient({ token: 'x', fetchFn: fn })
    const id = await client.findZoneId('api.example.com')
    expect(id).toBe('zone1')
    expect(calls[0]?.url).toContain('name=example.com')
  })

  test('findZoneId returns null when no match', async () => {
    const { fn } = makeFetch(() => ok([]))
    const client = new CloudflareClient({ token: 'x', fetchFn: fn })
    expect(await client.findZoneId('nope.example.com')).toBeNull()
  })

  test('error envelope is surfaced as Error with [code] messages', async () => {
    const { fn } = makeFetch(() => err(1001, 'nope'))
    const client = new CloudflareClient({ token: 'x', fetchFn: fn })
    await expect(client.listTunnels('acct')).rejects.toThrow(/\[1001\] nope/)
  })

  test('deleteDNSRecord uses DELETE', async () => {
    const { fn, calls } = makeFetch(() => ok({}))
    const client = new CloudflareClient({ token: 'x', fetchFn: fn })
    await client.deleteDNSRecord('zone1', 'rec1')
    expect(calls[0]?.method).toBe('DELETE')
    expect(calls[0]?.url).toContain('/zones/zone1/dns_records/rec1')
  })
})
