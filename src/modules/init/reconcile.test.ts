import { describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { type Config, ConfigError, configLoad, configWrite } from '@jib/config'
import { credsPath, getPaths } from '@jib/paths'
import { initInferredOptionalModules, initReconcileOptionalModules } from './reconcile.ts'

async function readConfig(file: string): Promise<Config> {
  const result = await configLoad(file)
  if (result instanceof ConfigError) throw result
  return result
}

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
    expect(await configWrite(join(root, 'config.yml'), config)).toBeUndefined()
    return await fn(config, root)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}

describe('initReconcileOptionalModules', () => {
  test('infers cloudflared when a tunnel token already exists', async () => {
    await withTmpConfig(async (cfg, root) => {
      const paths = getPaths(root)
      const tokenPath = credsPath(paths, 'cloudflare', 'tunnel.env')
      await mkdir(join(root, 'secrets', '_jib', 'cloudflare'), { recursive: true })
      await writeFile(tokenPath, 'TUNNEL_TOKEN=abc\n')

      expect(initInferredOptionalModules(cfg, paths)).toEqual({ cloudflared: true })

      const next = await initReconcileOptionalModules(cfg, paths)
      if (next instanceof Error) throw next
      expect(next.modules).toEqual({ cloudflared: true })
    })
  })

  test('can infer modules without persisting config changes', async () => {
    await withTmpConfig(async (cfg, root) => {
      const paths = getPaths(root)
      const tokenPath = credsPath(paths, 'cloudflare', 'tunnel.env')
      await mkdir(join(root, 'secrets', '_jib', 'cloudflare'), { recursive: true })
      await writeFile(tokenPath, 'TUNNEL_TOKEN=abc\n')

      const writes: Config[] = []
      const next = await initReconcileOptionalModules(cfg, paths, {
        writeConfig: async (_file: string, updated: Config) => {
          writes.push(structuredClone(updated))
          return undefined
        },
      })

      if (next instanceof Error) throw next
      expect(next.modules).toEqual({ cloudflared: true })
      expect(writes).toHaveLength(1)
      expect((await readConfig(paths.configFile)).modules).toEqual({})
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

      expect(initInferredOptionalModules(cfg, paths)).toEqual({})
      expect(await initReconcileOptionalModules(cfg, paths)).toBe(cfg)
    })
  })
})
