import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import type { ExecFn, ExecResult } from '../../exec.ts'
import { ingressApplyNginxConfig } from './config.ts'

interface TestCtx {
  calls: string[][]
  root: string
}

const ctx: TestCtx = { calls: [], root: '' }

beforeEach(async () => {
  ctx.calls = []
  ctx.root = await mkdtemp(join(tmpdir(), 'jib-ingress-config-'))
})

afterEach(async () => {
  await rm(ctx.root, { recursive: true, force: true })
})

function fakeExec(run: (argv: string[]) => ExecResult): ExecFn {
  return async (argv) => {
    ctx.calls.push(argv)
    return run(argv)
  }
}

describe('ingressApplyNginxConfig', () => {
  test('writes generic max body size as nginx client_max_body_size and reloads', async () => {
    const result = await ingressApplyNginxConfig(
      {
        root: ctx.root,
        configFile: join(ctx.root, 'config.yml'),
        stateDir: join(ctx.root, 'state'),
        locksDir: join(ctx.root, 'locks'),
        secretsDir: join(ctx.root, 'secrets'),
        overridesDir: join(ctx.root, 'overrides'),
        composeDir: join(ctx.root, 'compose'),
        reposDir: join(ctx.root, 'repos'),
        repoRoot: join(ctx.root, 'src'),
        nginxDir: join(ctx.root, 'nginx'),
        cloudflaredDir: join(ctx.root, 'cloudflared'),
      },
      {
        config_version: 3,
        poll_interval: '5m',
        modules: {},
        sources: {},
        apps: {},
        ingress: { max_body_size: '25m' },
      },
      fakeExec(() => ({ ok: true, stdout: '', stderr: '' })),
    )

    expect(result).toBeUndefined()
    expect(await readFile(join(ctx.root, 'nginx', '00-jib-ingress.conf'), 'utf8')).toContain(
      'client_max_body_size 25m;',
    )
    expect(ctx.calls).toEqual([
      ['sudo', '/usr/sbin/nginx', '-t'],
      ['sudo', 'systemctl', 'reload', 'nginx'],
    ])
  })
})
