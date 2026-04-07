import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SUBJECTS } from '@jib/rpc'
import { type TestCtx, claim, fakeExec, setup, waitFor } from './handlers.helpers.ts'
import type { CertExistsFn } from './handlers.ts'

const ctx: TestCtx = { tmpRoot: '', calls: [] }

beforeEach(async () => {
  ctx.tmpRoot = await mkdtemp(join(tmpdir(), 'jib-nginx-claim-'))
  ctx.calls = []
})
afterEach(async () => {
  await rm(ctx.tmpRoot, { recursive: true, force: true })
})

describe('nginx operator — claim', () => {
  test('writes files, runs nginx -t + reload, emits ready', async () => {
    const { bus, paths } = setup(
      ctx,
      fakeExec(ctx, () => ({ ok: true, stdout: '', stderr: '' })),
    )
    const ready: unknown[] = []
    bus.subscribe(SUBJECTS.evt.nginxReady, (p) => {
      ready.push(p)
    })
    bus.publish(SUBJECTS.cmd.nginxClaim, claim('web'))
    await waitFor(() => (ready.length ? ready : undefined))
    const files = await readdir(join(paths.nginxDir, 'web'))
    expect(files).toContain('web.example.com.conf')
    expect(ctx.calls[0]).toEqual(['nginx', '-t'])
    expect(ctx.calls[1]).toEqual(['sudo', 'systemctl', 'reload', 'nginx'])
  })

  test('rolls back when nginx -t fails', async () => {
    const { bus, paths } = setup(
      ctx,
      fakeExec(ctx, (c) =>
        c === 'nginx'
          ? { ok: false, stdout: '', stderr: 'bad config' }
          : { ok: true, stdout: '', stderr: '' },
      ),
    )
    const failed: Array<{ error: string }> = []
    bus.subscribe(SUBJECTS.evt.nginxFailed, (p) => {
      failed.push(p as { error: string })
    })
    bus.publish(SUBJECTS.cmd.nginxClaim, claim('web'))
    await waitFor(() => (failed.length ? failed : undefined))
    expect(failed[0]?.error).toContain('bad config')
    const files = await readdir(paths.nginxDir).catch(() => [])
    expect(files).toEqual([])
  })

  test('rolls back when systemctl reload fails', async () => {
    const { bus, paths } = setup(
      ctx,
      fakeExec(ctx, (c) =>
        c === 'sudo'
          ? { ok: false, stdout: '', stderr: 'reload boom' }
          : { ok: true, stdout: '', stderr: '' },
      ),
    )
    const failed: Array<{ error: string }> = []
    bus.subscribe(SUBJECTS.evt.nginxFailed, (p) => {
      failed.push(p as { error: string })
    })
    bus.publish(SUBJECTS.cmd.nginxClaim, claim('web'))
    await waitFor(() => (failed.length ? failed : undefined))
    expect(failed[0]?.error).toContain('reload boom')
    const files = await readdir(paths.nginxDir).catch(() => [])
    expect(files).toEqual([])
  })

  test('only touches files owned by its app', async () => {
    const { bus, paths } = setup(
      ctx,
      fakeExec(ctx, () => ({ ok: true, stdout: '', stderr: '' })),
    )
    const ready: unknown[] = []
    bus.subscribe(SUBJECTS.evt.nginxReady, (p) => {
      ready.push(p)
    })
    bus.publish(SUBJECTS.cmd.nginxClaim, claim('web'))
    await waitFor(() => ready.length >= 1 || undefined)
    bus.publish(SUBJECTS.cmd.nginxClaim, claim('api'))
    await waitFor(() => ready.length >= 2 || undefined)
    const dirs = (await readdir(paths.nginxDir)).sort()
    expect(dirs).toEqual(['api', 'web'])
  })

  test('honors isTunnel flag (no acme-challenge, no 443 block)', async () => {
    const { bus, paths } = setup(
      ctx,
      fakeExec(ctx, () => ({ ok: true, stdout: '', stderr: '' })),
    )
    const ready: unknown[] = []
    bus.subscribe(SUBJECTS.evt.nginxReady, (p) => {
      ready.push(p)
    })
    bus.publish(SUBJECTS.cmd.nginxClaim, {
      corrId: 'c-tun',
      ts: new Date().toISOString(),
      source: 'test',
      app: 'tun',
      domains: [{ host: 'tun.example.com', port: 20000, isTunnel: true }],
    })
    await waitFor(() => (ready.length ? ready : undefined))
    const body = await readFile(join(paths.nginxDir, 'tun', 'tun.example.com.conf'), 'utf8')
    expect(body).not.toContain('acme-challenge')
    expect(body).not.toContain('listen 443')
  })

  test('probes certExists and emits 443 block when cert present', async () => {
    const seen: string[] = []
    const certExists: CertExistsFn = async (host) => {
      seen.push(host)
      return host === 'ssl.example.com'
    }
    const { bus, paths } = setup(
      ctx,
      fakeExec(ctx, () => ({ ok: true, stdout: '', stderr: '' })),
      certExists,
    )
    const ready: unknown[] = []
    bus.subscribe(SUBJECTS.evt.nginxReady, (p) => {
      ready.push(p)
    })
    bus.publish(SUBJECTS.cmd.nginxClaim, {
      corrId: 'c-ssl',
      ts: new Date().toISOString(),
      source: 'test',
      app: 'ssl',
      domains: [{ host: 'ssl.example.com', port: 20001, isTunnel: false }],
    })
    await waitFor(() => (ready.length ? ready : undefined))
    const body = await readFile(join(paths.nginxDir, 'ssl', 'ssl.example.com.conf'), 'utf8')
    expect(body).toContain('listen 443 ssl')
    expect(body).toContain('fullchain.pem')
    expect(body).toContain('return 301 https://')
    expect(seen).toEqual(['ssl.example.com'])
  })

  test('skips certExists probe for tunnel backends', async () => {
    let probed = 0
    const certExists: CertExistsFn = async () => {
      probed++
      return true
    }
    const { bus } = setup(
      ctx,
      fakeExec(ctx, () => ({ ok: true, stdout: '', stderr: '' })),
      certExists,
    )
    const ready: unknown[] = []
    bus.subscribe(SUBJECTS.evt.nginxReady, (p) => {
      ready.push(p)
    })
    bus.publish(SUBJECTS.cmd.nginxClaim, {
      corrId: 'c-tun2',
      ts: new Date().toISOString(),
      source: 'test',
      app: 'tun2',
      domains: [{ host: 'tun2.example.com', port: 20002, isTunnel: true }],
    })
    await waitFor(() => (ready.length ? ready : undefined))
    expect(probed).toBe(0)
  })
})
