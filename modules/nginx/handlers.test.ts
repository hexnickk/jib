import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdtemp, readFile, readdir, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createLogger, getPaths } from '@jib/core'
import { FakeBus, SUBJECTS, flush } from '@jib/rpc'
import { registerNginxHandlers } from './handlers.ts'
import type { ExecFn, ExecResult } from './shell.ts'

let tmpRoot: string
let calls: string[][]

function fakeExec(map: (cmd: string) => ExecResult): ExecFn {
  return async (argv) => {
    calls.push(argv)
    return map(argv[0] ?? '')
  }
}

async function waitFor<T>(fn: () => T | undefined, max = 30): Promise<T> {
  for (let i = 0; i < max; i++) {
    const v = fn()
    if (v !== undefined) return v
    await flush()
  }
  throw new Error('timed out')
}

beforeEach(async () => {
  tmpRoot = await mkdtemp(join(tmpdir(), 'jib-nginx-op-'))
  calls = []
})
afterEach(async () => {
  await rm(tmpRoot, { recursive: true, force: true })
})

function setup(exec: ExecFn) {
  const bus = new FakeBus()
  const paths = getPaths(tmpRoot)
  const disposer = registerNginxHandlers(bus.asBus(), {
    paths,
    log: createLogger('nginx-test'),
    exec,
  })
  return { bus, paths, disposer }
}

function claim(app: string) {
  return {
    corrId: `c-${app}`,
    ts: new Date().toISOString(),
    source: 'test',
    app,
    domains: [{ host: `${app}.example.com`, port: 8080, containerPort: 80 }],
  }
}

describe('nginx operator handlers', () => {
  test('cmd.nginx.claim writes files, runs nginx -t + reload, emits ready', async () => {
    const { bus, paths } = setup(fakeExec(() => ({ ok: true, stdout: '', stderr: '' })))
    const ready: unknown[] = []
    bus.subscribe(SUBJECTS.evt.nginxReady, (p) => {
      ready.push(p)
    })
    bus.publish(SUBJECTS.cmd.nginxClaim, claim('web'))
    await waitFor(() => (ready.length ? ready : undefined))
    const files = await readdir(join(paths.nginxDir, 'web'))
    expect(files).toContain('web.example.com.conf')
    expect(calls[0]).toEqual(['nginx', '-t'])
    expect(calls[1]).toEqual(['systemctl', 'reload', 'nginx'])
  })

  test('cmd.nginx.claim rolls back when nginx -t fails', async () => {
    const { bus, paths } = setup(
      fakeExec((c) =>
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

  test('cmd.nginx.claim rolls back when systemctl reload fails', async () => {
    const { bus, paths } = setup(
      fakeExec((c) =>
        c === 'systemctl'
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

  test('cmd.nginx.release removes files + reloads and emits released', async () => {
    const { bus, paths } = setup(fakeExec(() => ({ ok: true, stdout: '', stderr: '' })))
    const ready: unknown[] = []
    const released: unknown[] = []
    bus.subscribe(SUBJECTS.evt.nginxReady, (p) => {
      ready.push(p)
    })
    bus.subscribe(SUBJECTS.evt.nginxReleased, (p) => {
      released.push(p)
    })
    bus.publish(SUBJECTS.cmd.nginxClaim, claim('web'))
    await waitFor(() => (ready.length ? ready : undefined))
    calls = []
    bus.publish(SUBJECTS.cmd.nginxRelease, {
      corrId: 'r1',
      ts: new Date().toISOString(),
      source: 'test',
      app: 'web',
    })
    await waitFor(() => (released.length ? released : undefined))
    const files = await readdir(paths.nginxDir)
    expect(files).toEqual([])
    expect(calls[0]).toEqual(['nginx', '-t'])
    expect(calls[1]).toEqual(['systemctl', 'reload', 'nginx'])
  })

  test('cmd.nginx.release is idempotent when no files exist', async () => {
    const { bus } = setup(fakeExec(() => ({ ok: true, stdout: '', stderr: '' })))
    const released: unknown[] = []
    bus.subscribe(SUBJECTS.evt.nginxReleased, (p) => {
      released.push(p)
    })
    bus.publish(SUBJECTS.cmd.nginxRelease, {
      corrId: 'r2',
      ts: new Date().toISOString(),
      source: 'test',
      app: 'ghost',
    })
    await waitFor(() => (released.length ? released : undefined))
    expect(calls).toEqual([])
  })

  test('cmd.nginx.claim only touches files owned by its app', async () => {
    const { bus, paths } = setup(fakeExec(() => ({ ok: true, stdout: '', stderr: '' })))
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

  test('cmd.nginx.claim honors isTunnel flag (no acme-challenge block)', async () => {
    const { bus, paths } = setup(fakeExec(() => ({ ok: true, stdout: '', stderr: '' })))
    const ready: unknown[] = []
    bus.subscribe(SUBJECTS.evt.nginxReady, (p) => {
      ready.push(p)
    })
    bus.publish(SUBJECTS.cmd.nginxClaim, {
      corrId: 'c-tun',
      ts: new Date().toISOString(),
      source: 'test',
      app: 'tun',
      domains: [
        { host: 'tun.example.com', port: 20000, containerPort: 80, isTunnel: true, hasSSL: false },
      ],
    })
    await waitFor(() => (ready.length ? ready : undefined))
    const body = await readFile(join(paths.nginxDir, 'tun', 'tun.example.com.conf'), 'utf8')
    expect(body).not.toContain('acme-challenge')
    expect(body).not.toContain('listen 443')
  })

  test('cmd.nginx.claim honors hasSSL flag (emits 443 block + redirect)', async () => {
    const { bus, paths } = setup(fakeExec(() => ({ ok: true, stdout: '', stderr: '' })))
    const ready: unknown[] = []
    bus.subscribe(SUBJECTS.evt.nginxReady, (p) => {
      ready.push(p)
    })
    bus.publish(SUBJECTS.cmd.nginxClaim, {
      corrId: 'c-ssl',
      ts: new Date().toISOString(),
      source: 'test',
      app: 'ssl',
      domains: [
        { host: 'ssl.example.com', port: 20001, containerPort: 80, isTunnel: false, hasSSL: true },
      ],
    })
    await waitFor(() => (ready.length ? ready : undefined))
    const body = await readFile(join(paths.nginxDir, 'ssl', 'ssl.example.com.conf'), 'utf8')
    expect(body).toContain('listen 443 ssl')
    expect(body).toContain('fullchain.pem')
    expect(body).toContain('return 301 https://')
  })

  test('cmd.nginx.release for `foo` leaves `foo-bar` untouched (no prefix collision)', async () => {
    const { bus, paths } = setup(fakeExec(() => ({ ok: true, stdout: '', stderr: '' })))
    const ready: unknown[] = []
    const released: unknown[] = []
    bus.subscribe(SUBJECTS.evt.nginxReady, (p) => {
      ready.push(p)
    })
    bus.subscribe(SUBJECTS.evt.nginxReleased, (p) => {
      released.push(p)
    })
    bus.publish(SUBJECTS.cmd.nginxClaim, claim('foo'))
    await waitFor(() => ready.length >= 1 || undefined)
    bus.publish(SUBJECTS.cmd.nginxClaim, claim('foo-bar'))
    await waitFor(() => ready.length >= 2 || undefined)
    bus.publish(SUBJECTS.cmd.nginxRelease, {
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
