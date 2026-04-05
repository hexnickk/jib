import { describe, expect, test } from 'bun:test'
import { createHmac } from 'node:crypto'
import type { Config } from '@jib/config'
import { createLogger } from '@jib/core'
import { FakeBus, SUBJECTS, flush } from '@jib/rpc'
import { handleRequest, verifySignature } from './server.ts'

const cfg: Config = {
  config_version: 3,
  poll_interval: '5m',
  apps: {
    demo: {
      repo: 'acme/demo',
      branch: 'main',
      domains: [{ host: 'demo.example.com', port: 3000 }],
      env_file: '.env',
    },
  },
} as Config

const SECRET = 'topsecret'

function sign(body: string): string {
  return `sha256=${createHmac('sha256', SECRET).update(body).digest('hex')}`
}

function pushBody(opts: { repo: string; branch: string; sha: string }): string {
  return JSON.stringify({
    ref: `refs/heads/${opts.branch}`,
    after: opts.sha,
    repository: { full_name: opts.repo },
  })
}

function makeReq(body: string, headers: Record<string, string> = {}): Request {
  return new Request('http://localhost/webhooks/jib', {
    method: 'POST',
    body,
    headers: { 'content-type': 'application/json', ...headers },
  })
}

function makeDeps() {
  const bus = new FakeBus()
  const deps = {
    bus: bus.asBus(),
    getConfig: () => cfg,
    secret: SECRET,
    log: createLogger('webhook-test'),
  }
  return { bus, deps }
}

describe('verifySignature', () => {
  test('accepts a valid sha256 hmac', () => {
    const body = 'hello'
    expect(verifySignature(SECRET, body, sign(body))).toBe(true)
  })
  test('rejects missing or malformed header', () => {
    expect(verifySignature(SECRET, 'x', null)).toBe(false)
    expect(verifySignature(SECRET, 'x', 'md5=abcd')).toBe(false)
  })
  test('rejects tampered body', () => {
    expect(verifySignature(SECRET, 'bye', sign('hello'))).toBe(false)
  })
})

describe('handleRequest', () => {
  test('401 on missing signature', async () => {
    const { deps } = makeDeps()
    const res = await handleRequest(makeReq('{}'), deps)
    expect(res.status).toBe(401)
  })

  test('401 on bad signature', async () => {
    const { deps } = makeDeps()
    const body = pushBody({ repo: 'acme/demo', branch: 'main', sha: 'abc123' })
    const res = await handleRequest(
      makeReq(body, { 'x-hub-signature-256': 'sha256=deadbeef' }),
      deps,
    )
    expect(res.status).toBe(401)
  })

  test('404 on wrong path', async () => {
    const { deps } = makeDeps()
    const res = await handleRequest(new Request('http://localhost/nope', { method: 'POST' }), deps)
    expect(res.status).toBe(404)
  })

  test('200 with ignored on unknown event type', async () => {
    const { deps } = makeDeps()
    const body = 'ping'
    const res = await handleRequest(
      makeReq(body, { 'x-hub-signature-256': sign(body), 'x-github-event': 'ping' }),
      deps,
    )
    expect(res.status).toBe(200)
  })

  test('200 no-publish for unknown repo', async () => {
    const { bus, deps } = makeDeps()
    const published: string[] = []
    bus.subscribe(SUBJECTS.cmd.repoPrepare, () => void published.push('prepare'))
    const body = pushBody({ repo: 'other/thing', branch: 'main', sha: 'abc123' })
    const res = await handleRequest(
      makeReq(body, { 'x-hub-signature-256': sign(body), 'x-github-event': 'push' }),
      deps,
    )
    await flush()
    expect(res.status).toBe(200)
    expect(published).toEqual([])
  })

  test('202 + publishes cmd.repo.prepare for matching repo', async () => {
    const { bus, deps } = makeDeps()
    const seen: unknown[] = []
    bus.subscribe(SUBJECTS.cmd.repoPrepare, (payload) => void seen.push(payload))
    const body = pushBody({ repo: 'acme/demo', branch: 'main', sha: 'abc123' })
    const res = await handleRequest(
      makeReq(body, { 'x-hub-signature-256': sign(body), 'x-github-event': 'push' }),
      deps,
    )
    await flush()
    expect(res.status).toBe(202)
    expect(seen).toHaveLength(1)
    const cmd = seen[0] as { app: string; ref: string }
    expect(cmd.app).toBe('demo')
    expect(cmd.ref).toBe('abc123')
  })
})
