import { describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { type Config, writeConfig } from '@jib/config'
import { credsPath, getPaths } from '@jib/paths'
import { inferredOptionalModules, reconcileOptionalModules } from './reconcile.ts'

async function withTmpConfig<T>(fn: (cfg: Config, root: string) => Promise<T>): Promise<T> {
  const root = await mkdtemp(join(tmpdir(), 'jib-init-reconcile-'))
  const config = {
    config_version: 3,
    poll_interval: '5m',
    modules: {},
    sources: {},
    apps: {},
  } satisfies Config
  try {
    await mkdir(root, { recursive: true })
    await writeConfig(join(root, 'config.yml'), config)
    return await fn(config, root)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}

describe('reconcileOptionalModules', () => {
  test('infers cloudflared when a tunnel token already exists', async () => {
    await withTmpConfig(async (cfg, root) => {
      const paths = getPaths(root)
      const tokenPath = credsPath(paths, 'cloudflare', 'tunnel.env')
      await mkdir(join(root, 'secrets', '_jib', 'cloudflare'), { recursive: true })
      await writeFile(tokenPath, 'TUNNEL_TOKEN=abc\n')

      expect(inferredOptionalModules(cfg, paths)).toEqual({ cloudflared: true })

      const next = await reconcileOptionalModules(cfg, paths)
      expect(next.modules).toEqual({ cloudflared: true })
    })
  })

  test('preserves explicit module decisions', async () => {
    await withTmpConfig(async (_, root) => {
      const paths = getPaths(root)
      const tokenPath = credsPath(paths, 'cloudflare', 'tunnel.env')
      await mkdir(join(root, 'secrets', '_jib', 'cloudflare'), { recursive: true })
      await writeFile(tokenPath, 'TUNNEL_TOKEN=abc\n')
      const cfg = {
        config_version: 3,
        poll_interval: '5m',
        modules: { cloudflared: false },
        sources: { demo: { driver: 'github', type: 'key' } },
        apps: {},
      } satisfies Config

      expect(inferredOptionalModules(cfg, paths)).toEqual({})
      expect(await reconcileOptionalModules(cfg, paths)).toBe(cfg)
    })
  })
})
