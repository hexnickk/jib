import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdtemp, readFile, readdir, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { type ExecFn, type ExecResult, createNginxIngressOperator } from './index.ts'

interface TestCtx {
  calls: string[][]
  nginxDir: string
}

const ctx: TestCtx = { calls: [], nginxDir: '' }

beforeEach(async () => {
  ctx.calls = []
  ctx.nginxDir = await mkdtemp(join(tmpdir(), 'jib-ingress-nginx-'))
})

afterEach(async () => {
  await rm(ctx.nginxDir, { recursive: true, force: true })
})

function fakeExec(run: (argv: string[]) => ExecResult): ExecFn {
  return async (argv) => {
    ctx.calls.push(argv)
    return run(argv)
  }
}

function operator(exec: ExecFn) {
  return createNginxIngressOperator({
    nginxDir: ctx.nginxDir,
    exec,
    certExists: async (host) => host === 'ssl.example.com',
  })
}

describe('createNginxIngressOperator', () => {
  test('claim writes files and reloads nginx', async () => {
    await operator(fakeExec(() => ({ ok: true, stdout: '', stderr: '' }))).claim({
      app: 'web',
      domains: [{ host: 'web.example.com', port: 8080, isTunnel: false }],
    })

    const files = await readdir(join(ctx.nginxDir, 'web'))
    expect(files).toContain('web.example.com.conf')
    expect(ctx.calls[0]).toEqual(['sudo', 'nginx', '-t'])
    expect(ctx.calls[1]).toEqual(['sudo', 'systemctl', 'reload', 'nginx'])
  })

  test('claim rolls back when reload fails', async () => {
    const ingress = operator(
      fakeExec((argv) =>
        argv[1] === 'systemctl'
          ? { ok: false, stdout: '', stderr: 'reload boom' }
          : { ok: true, stdout: '', stderr: '' },
      ),
    )

    await expect(
      ingress.claim({
        app: 'web',
        domains: [{ host: 'web.example.com', port: 8080, isTunnel: false }],
      }),
    ).rejects.toThrow('reload boom')

    const files = await readdir(ctx.nginxDir).catch(() => [])
    expect(files).toEqual([])
  })

  test('claim preserves SSL and tunnel rendering rules', async () => {
    const ingress = operator(fakeExec(() => ({ ok: true, stdout: '', stderr: '' })))

    await ingress.claim({
      app: 'edge',
      domains: [
        { host: 'ssl.example.com', port: 20000, isTunnel: false },
        { host: 'tun.example.com', port: 20001, isTunnel: true },
      ],
    })

    const ssl = await readFile(join(ctx.nginxDir, 'edge', 'ssl.example.com.conf'), 'utf8')
    const tun = await readFile(join(ctx.nginxDir, 'edge', 'tun.example.com.conf'), 'utf8')
    expect(ssl).toContain('listen 443 ssl')
    expect(tun).not.toContain('listen 443')
    expect(tun).not.toContain('acme-challenge')
  })

  test('release removes only the target app directory', async () => {
    const ingress = operator(fakeExec(() => ({ ok: true, stdout: '', stderr: '' })))

    await ingress.claim({
      app: 'foo',
      domains: [{ host: 'foo.example.com', port: 8080, isTunnel: false }],
    })
    await ingress.claim({
      app: 'foo-bar',
      domains: [{ host: 'foo-bar.example.com', port: 8081, isTunnel: false }],
    })

    ctx.calls = []
    await ingress.release('foo')

    const foo = await stat(join(ctx.nginxDir, 'foo')).catch(() => null)
    const fooBar = await stat(join(ctx.nginxDir, 'foo-bar')).catch(() => null)
    expect(foo).toBeNull()
    expect(fooBar?.isDirectory()).toBe(true)
    expect(ctx.calls[0]).toEqual(['sudo', 'nginx', '-t'])
    expect(ctx.calls[1]).toEqual(['sudo', 'systemctl', 'reload', 'nginx'])
  })
})
