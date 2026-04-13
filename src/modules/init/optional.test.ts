import { describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { type Config, ConfigError, configLoad, configWrite } from '@jib/config'
import { pathsGetPaths } from '@jib/paths'
import {
  InitModuleInstallError,
  OptionalModuleChoicePersistError,
  OptionalModuleSetupError,
} from './errors.ts'
import { initConfigureOptionalModules, initPersistModuleChoice } from './optional.ts'
import type { ModLike } from './registry.ts'

async function readConfig(file: string): Promise<Config> {
  const result = await configLoad(file)
  if (result instanceof ConfigError) throw result
  return result
}

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
    expect(await configWrite(join(root, 'config.yml'), config)).toBeUndefined()
    return await fn(config, root)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}

function mod(name: string): ModLike {
  return { manifest: { name } }
}

describe('optional module configuration', () => {
  test('initPersistModuleChoice preserves unrelated config edits', async () => {
    await withTmpConfig(async (_, root) => {
      const file = join(root, 'config.yml')
      expect(
        await configWrite(file, {
          config_version: 3,
          poll_interval: '5m',
          modules: {},
          sources: { demo: { driver: 'github', type: 'key' } },
          apps: {},
        } satisfies Config),
      ).toBeUndefined()

      const updated = await initPersistModuleChoice(file, 'cloudflared', true)
      if (updated instanceof OptionalModuleChoicePersistError) {
        throw new Error('expected updated config')
      }
      expect(updated.modules.cloudflared).toBe(true)
      expect(updated.sources.demo).toEqual({ driver: 'github', type: 'key' })
    })
  })

  test('initPersistModuleChoice returns a typed error when persistence fails', async () => {
    const error = await initPersistModuleChoice('/tmp/missing.yml', 'cloudflared', true, {
      loadConfig: async () => {
        throw new Error('config missing')
      },
    })

    expect(error).toBeInstanceOf(OptionalModuleChoicePersistError)
    if (!(error instanceof OptionalModuleChoicePersistError)) {
      throw new Error('expected OptionalModuleChoicePersistError')
    }
    expect(error.message).toBe('config missing')
  })

  test('initConfigureOptionalModules preserves setup-written config before enabling the module', async () => {
    await withTmpConfig(async (cfg, root) => {
      const paths = pathsGetPaths(root)
      const mods: ModLike[] = [mod('source-auth')]

      expect(
        await initConfigureOptionalModules(cfg, paths, mods, {
          promptOptionalModule: async () => true,
          resolveModuleSetup: (name) =>
            name === 'source-auth'
              ? async (ctx) => {
                  const next = await readConfig(ctx.paths.configFile)
                  next.sources.demo = { driver: 'github', type: 'key' }
                  expect(await configWrite(ctx.paths.configFile, next)).toBeUndefined()
                  return true
                }
              : undefined,
        }),
      ).toBeUndefined()

      const final = await readConfig(paths.configFile)
      expect(final.modules).toEqual({ 'source-auth': true })
      expect(final.sources.demo).toEqual({ driver: 'github', type: 'key' })
    })
  })

  test('initConfigureOptionalModules rolls back install when setup does not complete', async () => {
    await withTmpConfig(async (cfg, root) => {
      const paths = pathsGetPaths(root)
      const calls: string[] = []
      const mods: ModLike[] = [
        {
          manifest: { name: 'cloudflared' },
          install: async () => {
            calls.push('install')
            return undefined
          },
          uninstall: async () => {
            calls.push('uninstall')
            return undefined
          },
        },
      ]

      const error = await initConfigureOptionalModules(cfg, paths, mods, {
        promptOptionalModule: async () => true,
        resolveModuleSetup: () => async () => false,
      })

      expect(error).toBeInstanceOf(OptionalModuleSetupError)
      if (!(error instanceof OptionalModuleSetupError)) {
        throw new Error('expected OptionalModuleSetupError')
      }
      expect(error.message).toBe('cloudflared setup did not complete')
      expect(calls).toEqual(['install', 'uninstall'])

      const final = await readConfig(paths.configFile)
      expect(final.modules).toEqual({})
    })
  })

  test('initConfigureOptionalModules does not enable a module when setup does not complete', async () => {
    await withTmpConfig(async (cfg, root) => {
      const paths = pathsGetPaths(root)
      const mods: ModLike[] = [mod('cloudflared')]

      const error = await initConfigureOptionalModules(cfg, paths, mods, {
        promptOptionalModule: async () => true,
        resolveModuleSetup: () => async () => false,
      })

      expect(error).toBeInstanceOf(OptionalModuleSetupError)
      if (!(error instanceof OptionalModuleSetupError)) {
        throw new Error('expected OptionalModuleSetupError')
      }
      expect(error.message).toBe('cloudflared setup did not complete')

      const final = await readConfig(paths.configFile)
      expect(final.modules).toEqual({})
    })
  })

  test('initConfigureOptionalModules keeps earlier choices when a later setup fails', async () => {
    await withTmpConfig(async (cfg, root) => {
      const paths = pathsGetPaths(root)
      const mods: ModLike[] = [mod('cloudflared'), mod('source-auth')]
      const answers = [true, true]

      const error = await initConfigureOptionalModules(cfg, paths, mods, {
        promptOptionalModule: async () => answers.shift() ?? false,
        resolveModuleSetup: (name) =>
          name === 'source-auth'
            ? async (ctx) => {
                const next = await readConfig(ctx.paths.configFile)
                next.sources.demo = { driver: 'github', type: 'key' }
                expect(await configWrite(ctx.paths.configFile, next)).toBeUndefined()
                throw new Error('stop after saving source')
              }
            : undefined,
      })

      expect(error).toBeInstanceOf(OptionalModuleSetupError)
      if (!(error instanceof OptionalModuleSetupError)) {
        throw new Error('expected OptionalModuleSetupError')
      }
      expect(error.message).toBe('stop after saving source')

      const final = await readConfig(paths.configFile)
      expect(final.modules).toEqual({ cloudflared: true })
      expect(final.sources.demo).toEqual({ driver: 'github', type: 'key' })
    })
  })

  test('initConfigureOptionalModules converts thrown install dependency failures', async () => {
    await withTmpConfig(async (cfg, root) => {
      const paths = pathsGetPaths(root)
      const mods: ModLike[] = [
        {
          manifest: { name: 'cloudflared' },
          install: async () => undefined,
        },
      ]

      const error = await initConfigureOptionalModules(cfg, paths, mods, {
        promptOptionalModule: async () => true,
        resolveModuleSetup: () => undefined,
        runInstallsTx: async () => {
          throw new Error('install dependency blew up')
        },
      })

      expect(error).toBeInstanceOf(InitModuleInstallError)
      if (!(error instanceof InitModuleInstallError)) {
        throw new Error('expected InitModuleInstallError')
      }
      expect(error.message).toBe('install dependency blew up')
      expect(error.moduleName).toBe('cloudflared')
    })
  })

  test('initConfigureOptionalModules returns typed setup errors', async () => {
    await withTmpConfig(async (cfg, root) => {
      const paths = pathsGetPaths(root)
      const mods: ModLike[] = [mod('cloudflared')]

      expect(
        await initConfigureOptionalModules(cfg, paths, mods, {
          promptOptionalModule: async () => true,
          resolveModuleSetup: () => async () => false,
        }),
      ).toBeInstanceOf(OptionalModuleSetupError)
    })
  })
})
