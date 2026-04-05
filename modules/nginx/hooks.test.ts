import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Config } from '@jib/config'
import { createLogger, getPaths } from '@jib/core'
import { setupHooks } from './hooks.ts'
import { type ExecFn, type ExecResult, setExec } from './shell.ts'

type Call = string[]

function makeConfig(domainIngress: 'direct' | 'cloudflare-tunnel' = 'direct'): Config {
  return {
    config_version: 3,
    poll_interval: '5m',
    apps: {
      web: {
        repo: 'acme/web',
        branch: 'main',
        env_file: '.env',
        domains: [{ host: 'web.example.com', port: 8080, ingress: domainIngress }],
      },
    },
  }
}

let tmpRoot: string
let calls: Call[]

function fakeExec(result: (cmd: string) => ExecResult): ExecFn {
  return async (argv) => {
    calls.push(argv)
    return result(argv[0] ?? '')
  }
}

beforeEach(async () => {
  tmpRoot = await mkdtemp(join(tmpdir(), 'jib-nginx-'))
  calls = []
})

afterEach(async () => {
  setExec(null)
  await rm(tmpRoot, { recursive: true, force: true })
})

function makeCtx(cfg: Config) {
  const paths = getPaths(tmpRoot)
  return { config: cfg, logger: createLogger('nginx-test'), paths }
}

describe('nginx setupHooks', () => {
  test('onAppAdd writes per-domain conf file and reloads on success', async () => {
    setExec(fakeExec(() => ({ ok: true, stdout: '', stderr: '' })))
    const cfg = makeConfig('cloudflare-tunnel')
    await setupHooks.onAppAdd?.(makeCtx(cfg), 'web')

    const files = await readdir(getPaths(tmpRoot).nginxDir)
    expect(files).toContain('web.example.com.conf')
    const body = await readFile(join(getPaths(tmpRoot).nginxDir, 'web.example.com.conf'), 'utf8')
    expect(body).toContain('proxy_pass http://127.0.0.1:8080')

    expect(calls.map((c) => c[0])).toEqual(['nginx', 'systemctl'])
    expect(calls[0]).toEqual(['nginx', '-t'])
    expect(calls[1]).toEqual(['systemctl', 'reload', 'nginx'])
  })

  test('onAppAdd does NOT reload and rolls back written configs when nginx -t fails', async () => {
    setExec(
      fakeExec((cmd) =>
        cmd === 'nginx'
          ? { ok: false, stdout: '', stderr: 'config broken' }
          : { ok: true, stdout: '', stderr: '' },
      ),
    )
    await setupHooks.onAppAdd?.(makeCtx(makeConfig('cloudflare-tunnel')), 'web')
    expect(calls.map((c) => c[0])).toEqual(['nginx'])
    // Rollback: the conf file we wrote must be gone so on-disk state matches
    // the (unreloaded) running nginx config.
    const files = await readdir(getPaths(tmpRoot).nginxDir).catch(() => [])
    expect(files).toEqual([])
  })

  test('onAppAdd rolls back when systemctl reload fails after nginx -t passes', async () => {
    setExec(
      fakeExec((cmd) =>
        cmd === 'systemctl'
          ? { ok: false, stdout: '', stderr: 'reload failed' }
          : { ok: true, stdout: '', stderr: '' },
      ),
    )
    await setupHooks.onAppAdd?.(makeCtx(makeConfig('cloudflare-tunnel')), 'web')
    const files = await readdir(getPaths(tmpRoot).nginxDir).catch(() => [])
    expect(files).toEqual([])
  })

  test('onAppRemove deletes confs and reloads', async () => {
    setExec(fakeExec(() => ({ ok: true, stdout: '', stderr: '' })))
    const ctx = makeCtx(makeConfig('cloudflare-tunnel'))
    await setupHooks.onAppAdd?.(ctx, 'web')
    calls = []
    await setupHooks.onAppRemove?.(ctx, 'web')
    const files = await readdir(getPaths(tmpRoot).nginxDir)
    expect(files).toEqual([])
    expect(calls).toEqual([
      ['nginx', '-t'],
      ['systemctl', 'reload', 'nginx'],
    ])
  })

  test('missing app in config is a no-op (no reload)', async () => {
    setExec(fakeExec(() => ({ ok: true, stdout: '', stderr: '' })))
    await setupHooks.onAppAdd?.(makeCtx(makeConfig()), 'ghost')
    expect(calls).toEqual([])
  })
})
