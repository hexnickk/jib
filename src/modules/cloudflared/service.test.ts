import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { configLoad, configWrite } from '@jib/config'
import { pathsGetPaths } from '@jib/paths'
import { describe, expect, test } from 'vitest'
import {
  CloudflaredSaveTunnelTokenError,
  cloudflaredEnableConfig,
  cloudflaredEnableService,
  cloudflaredHasTunnelToken,
  cloudflaredSaveTunnelToken,
  cloudflaredTunnelTokenPath,
} from './index.ts'

async function withTmpPaths<T>(fn: (root: string) => Promise<T>): Promise<T> {
  const root = await mkdtemp(join(tmpdir(), 'jib-cloudflared-'))
  try {
    return await fn(root)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}

describe('cloudflared service helpers', () => {
  test('cloudflaredHasTunnelToken returns false before a token is saved', async () => {
    await withTmpPaths(async (root) => {
      expect(cloudflaredHasTunnelToken(pathsGetPaths(root))).toBe(false)
    })
  })

  test('cloudflaredSaveTunnelToken writes the normalized env file', async () => {
    await withTmpPaths(async (root) => {
      const paths = pathsGetPaths(root)

      const saved = await cloudflaredSaveTunnelToken(
        paths,
        'cloudflared tunnel run --token eyJhIjoiNzQ',
      )

      expect(saved).toBe(true)
      expect(cloudflaredHasTunnelToken(paths)).toBe(true)
      expect(await readFile(cloudflaredTunnelTokenPath(paths), 'utf8')).toBe(
        'TUNNEL_TOKEN=eyJhIjoiNzQ\n',
      )
      expect((await stat(join(root, 'secrets', '_jib', 'cloudflare'))).mode & 0o7777).toBe(0o2770)
    })
  })

  test('cloudflaredSaveTunnelToken skips blank or invalid cloudflared commands', async () => {
    await withTmpPaths(async (root) => {
      const paths = pathsGetPaths(root)

      expect(await cloudflaredSaveTunnelToken(paths, '')).toBe(false)
      expect(await cloudflaredSaveTunnelToken(paths, 'cloudflared service install')).toBe(false)
      expect(cloudflaredHasTunnelToken(paths)).toBe(false)
    })
  })

  test('cloudflaredSaveTunnelToken returns a typed filesystem error', async () => {
    await withTmpPaths(async (root) => {
      const paths = pathsGetPaths(root)
      await writeFile(join(root, 'secrets'), 'not-a-directory')

      const result = await cloudflaredSaveTunnelToken(paths, 'eyJhIjoiNzQ')

      expect(result).toBeInstanceOf(CloudflaredSaveTunnelTokenError)
      expect(result).toHaveProperty('cause')
    })
  })

  test('cloudflaredEnableConfig persists desired module enablement', async () => {
    await withTmpPaths(async (root) => {
      const paths = pathsGetPaths(root)
      expect(
        await configWrite(paths.configFile, {
          config_version: 3,
          poll_interval: '5m',
          modules: {},
          sources: {},
          apps: {},
        }),
      ).toBeUndefined()

      expect(await cloudflaredEnableConfig(paths)).toBeUndefined()
      const config = await configLoad(paths.configFile)
      if (config instanceof Error) throw config
      expect(config.modules.cloudflared).toBe(true)
    })
  })

  test('cloudflaredEnableService reports shell failures without throwing', async () => {
    const result = await cloudflaredEnableService({
      run: async () => ({
        exitCode: 1,
        stdout: Buffer.from(''),
        stderr: Buffer.from('permission denied'),
      }),
    })

    expect(result).toEqual({ ok: false, detail: 'permission denied' })
  })

  test('cloudflaredEnableService converts thrown runner errors into a failure result', async () => {
    const result = await cloudflaredEnableService({
      run: async () => {
        throw new Error('systemctl unavailable')
      },
    })

    expect(result).toEqual({ ok: false, detail: 'systemctl unavailable' })
  })
})
