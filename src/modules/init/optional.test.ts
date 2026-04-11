import { describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { type Config, loadConfig, writeConfig } from '@jib/config'
import { getPaths } from '@jib/paths'
import { configureOptionalModules, persistModuleChoice } from './optional.ts'
import type { ModLike } from './registry.ts'

async function withTmpConfig<T>(fn: (cfg: Config, root: string) => Promise<T>): Promise<T> {
  const root = await mkdtemp(join(tmpdir(), 'jib-init-optional-'))
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

function mod(name: string): ModLike {
  return { manifest: { name } }
}

describe('optional module configuration', () => {
  test('persistModuleChoice preserves unrelated config edits', async () => {
    await withTmpConfig(async (_, root) => {
      const file = join(root, 'config.yml')
      await writeConfig(file, {
        config_version: 3,
        poll_interval: '5m',
        modules: {},
        sources: { demo: { driver: 'github', type: 'key' } },
        apps: {},
      } satisfies Config)

      const updated = await persistModuleChoice(file, 'cloudflared', true)
      expect(updated.modules.cloudflared).toBe(true)
      expect(updated.sources.demo).toEqual({ driver: 'github', type: 'key' })
    })
  })

  test('configureOptionalModules preserves setup-written config before enabling the module', async () => {
    await withTmpConfig(async (cfg, root) => {
      const paths = getPaths(root)
      const mods: ModLike[] = [mod('source-auth')]

      await configureOptionalModules(cfg, paths, mods, {
        promptOptionalModule: async () => true,
        resolveModuleSetup: (name) =>
          name === 'source-auth'
            ? async (ctx) => {
                const next = await loadConfig(ctx.paths.configFile)
                next.sources.demo = { driver: 'github', type: 'key' }
                await writeConfig(ctx.paths.configFile, next)
                return true
              }
            : undefined,
      })

      const final = await loadConfig(paths.configFile)
      expect(final.modules).toEqual({ 'source-auth': true })
      expect(final.sources.demo).toEqual({ driver: 'github', type: 'key' })
    })
  })

  test('configureOptionalModules rolls back install when setup does not complete', async () => {
    await withTmpConfig(async (cfg, root) => {
      const paths = getPaths(root)
      const calls: string[] = []
      const mods: ModLike[] = [
        {
          manifest: { name: 'cloudflared' },
          install: async () => {
            calls.push('install')
          },
          uninstall: async () => {
            calls.push('uninstall')
          },
        },
      ]

      await expect(
        configureOptionalModules(cfg, paths, mods, {
          promptOptionalModule: async () => true,
          resolveModuleSetup: () => async () => false,
        }),
      ).rejects.toThrow('cloudflared setup did not complete')

      expect(calls).toEqual(['install', 'uninstall'])
      const final = await loadConfig(paths.configFile)
      expect(final.modules).toEqual({})
    })
  })

  test('configureOptionalModules does not enable a module when setup does not complete', async () => {
    await withTmpConfig(async (cfg, root) => {
      const paths = getPaths(root)
      const mods: ModLike[] = [mod('cloudflared')]

      await expect(
        configureOptionalModules(cfg, paths, mods, {
          promptOptionalModule: async () => true,
          resolveModuleSetup: () => async () => false,
        }),
      ).rejects.toThrow('cloudflared setup did not complete')

      const final = await loadConfig(paths.configFile)
      expect(final.modules).toEqual({})
    })
  })

  test('configureOptionalModules keeps earlier choices when a later setup fails', async () => {
    await withTmpConfig(async (cfg, root) => {
      const paths = getPaths(root)
      const mods: ModLike[] = [mod('cloudflared'), mod('source-auth')]
      const answers = [true, true]

      await expect(
        configureOptionalModules(cfg, paths, mods, {
          promptOptionalModule: async () => answers.shift() ?? false,
          resolveModuleSetup: (name) =>
            name === 'source-auth'
              ? async (ctx) => {
                  const next = await loadConfig(ctx.paths.configFile)
                  next.sources.demo = { driver: 'github', type: 'key' }
                  await writeConfig(ctx.paths.configFile, next)
                  throw new Error('stop after saving source')
                }
              : undefined,
        }),
      ).rejects.toThrow('stop after saving source')

      const final = await loadConfig(paths.configFile)
      expect(final.modules).toEqual({ cloudflared: true })
      expect(final.sources.demo).toEqual({ driver: 'github', type: 'key' })
    })
  })
})
