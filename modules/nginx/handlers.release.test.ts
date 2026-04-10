import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdtemp, readdir, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SUBJECTS } from '@jib/rpc'
import { type TestCtx, claim, fakeExec, setup, waitFor } from './handlers.helpers.ts'

const ctx: TestCtx = { tmpRoot: '', calls: [] }

beforeEach(async () => {
  ctx.tmpRoot = await mkdtemp(join(tmpdir(), 'jib-nginx-release-'))
  ctx.calls = []
})
afterEach(async () => {
  await rm(ctx.tmpRoot, { recursive: true, force: true })
})

describe('nginx operator — release', () => {
  test('removes files + reloads and emits released', async () => {
    const { bus, paths } = setup(
      ctx,
      fakeExec(ctx, () => ({ ok: true, stdout: '', stderr: '' })),
    )
    const ready: unknown[] = []
    const released: unknown[] = []
    bus.subscribe(SUBJECTS.evt.ingressReady, (p) => {
      ready.push(p)
    })
    bus.subscribe(SUBJECTS.evt.ingressReleased, (p) => {
      released.push(p)
    })
    bus.publish(SUBJECTS.cmd.ingressClaim, claim('web'))
    await waitFor(() => (ready.length ? ready : undefined))
    ctx.calls = []
    bus.publish(SUBJECTS.cmd.ingressRelease, {
      corrId: 'r1',
      ts: new Date().toISOString(),
      source: 'test',
      app: 'web',
    })
    await waitFor(() => (released.length ? released : undefined))
    const files = await readdir(paths.nginxDir)
    expect(files).toEqual([])
    expect(ctx.calls[0]).toEqual(['nginx', '-t'])
    expect(ctx.calls[1]).toEqual(['sudo', 'systemctl', 'reload', 'nginx'])
  })

  test('is idempotent when no files exist', async () => {
    const { bus } = setup(
      ctx,
      fakeExec(ctx, () => ({ ok: true, stdout: '', stderr: '' })),
    )
    const released: unknown[] = []
    bus.subscribe(SUBJECTS.evt.ingressReleased, (p) => {
      released.push(p)
    })
    bus.publish(SUBJECTS.cmd.ingressRelease, {
      corrId: 'r2',
      ts: new Date().toISOString(),
      source: 'test',
      app: 'ghost',
    })
    await waitFor(() => (released.length ? released : undefined))
    expect(ctx.calls).toEqual([])
  })

  test('restores prior config when release reload fails', async () => {
    let failReload = false
    const { bus, paths } = setup(
      ctx,
      fakeExec(ctx, (c) =>
        c === 'sudo' && failReload
          ? { ok: false, stdout: '', stderr: 'reload boom' }
          : { ok: true, stdout: '', stderr: '' },
      ),
    )
    const ready: unknown[] = []
    const failed: Array<{ error: string }> = []
    bus.subscribe(SUBJECTS.evt.ingressReady, (p) => {
      ready.push(p)
    })
    bus.subscribe(SUBJECTS.evt.ingressFailed, (p) => {
      failed.push(p as { error: string })
    })
    bus.publish(SUBJECTS.cmd.ingressClaim, claim('web'))
    await waitFor(() => (ready.length ? ready : undefined))
    failReload = true
    bus.publish(SUBJECTS.cmd.ingressRelease, {
      corrId: 'r-fail',
      ts: new Date().toISOString(),
      source: 'test',
      app: 'web',
    })
    await waitFor(() => (failed.length ? failed : undefined))
    const files = await readdir(join(paths.nginxDir, 'web'))
    expect(failed[0]?.error).toContain('reload boom')
    expect(files).toContain('web.example.com.conf')
  })

  test('release for `foo` leaves `foo-bar` untouched (no prefix collision)', async () => {
    const { bus, paths } = setup(
      ctx,
      fakeExec(ctx, () => ({ ok: true, stdout: '', stderr: '' })),
    )
    const ready: unknown[] = []
    const released: unknown[] = []
    bus.subscribe(SUBJECTS.evt.ingressReady, (p) => {
      ready.push(p)
    })
    bus.subscribe(SUBJECTS.evt.ingressReleased, (p) => {
      released.push(p)
    })
    bus.publish(SUBJECTS.cmd.ingressClaim, claim('foo'))
    await waitFor(() => ready.length >= 1 || undefined)
    bus.publish(SUBJECTS.cmd.ingressClaim, claim('foo-bar'))
    await waitFor(() => ready.length >= 2 || undefined)
    bus.publish(SUBJECTS.cmd.ingressRelease, {
      corrId: 'r-foo',
      ts: new Date().toISOString(),
      source: 'test',
      app: 'foo',
    })
    await waitFor(() => (released.length ? released : undefined))
    const fooBarStat = await stat(join(paths.nginxDir, 'foo-bar')).catch(() => null)
    expect(fooBarStat?.isDirectory()).toBe(true)
    const fooStat = await stat(join(paths.nginxDir, 'foo')).catch(() => null)
    expect(fooStat).toBeNull()
  })
})
