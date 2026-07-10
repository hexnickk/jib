import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { type Config, configLoad, configWrite } from '@jib/config'
import { pathsGetPaths } from '@jib/paths'
import { describe, expect, test } from 'vitest'
import { cloudflaredSaveTunnelToken } from './service.ts'
import { cloudflaredReadStatus } from './status.ts'

/** Creates isolated Cloudflare paths and removes them after each status scenario. */
async function withPaths<T>(
  run: (paths: ReturnType<typeof pathsGetPaths>) => Promise<T>,
): Promise<T> {
  const root = await mkdtemp(join(tmpdir(), 'jib-cloudflared-status-'))
  try {
    return await run(pathsGetPaths(root))
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}

function configWith(enabled: boolean): Config {
  return {
    config_version: 3,
    poll_interval: '5m',
    modules: enabled ? { cloudflared: true } : {},
    sources: {},
    apps: {},
  }
}

describe('cloudflaredReadStatus', () => {
  test('requires both module enablement and a managed token', async () => {
    await withPaths(async (paths) => {
      expect(cloudflaredReadStatus(configWith(false), paths)).toEqual({
        configured: false,
        enabled: false,
        hasToken: false,
      })

      expect(cloudflaredReadStatus(configWith(true), paths)).toEqual({
        configured: false,
        enabled: true,
        hasToken: false,
      })

      expect(await cloudflaredSaveTunnelToken(paths, 'eyJhIjoiNzQ')).toBe(true)
      expect(cloudflaredReadStatus(configWith(false), paths)).toEqual({
        configured: false,
        enabled: false,
        hasToken: true,
      })
      expect(cloudflaredReadStatus(configWith(true), paths)).toEqual({
        configured: true,
        enabled: true,
        hasToken: true,
      })
    })
  })

  test('reloads a tunnel-route config using the same authoritative state', async () => {
    await withPaths(async (paths) => {
      await mkdir(paths.root, { recursive: true })
      expect(await cloudflaredSaveTunnelToken(paths, 'eyJhIjoiNzQ')).toBe(true)
      expect(
        await configWrite(paths.configFile, {
          ...configWith(true),
          apps: {
            web: {
              repo: 'owner/web',
              branch: 'main',
              domains: [{ host: 'web.example.com', port: 20000, ingress: 'cloudflare-tunnel' }],
            },
          },
        }),
      ).toBeUndefined()

      const reloaded = await configLoad(paths.configFile)
      if (reloaded instanceof Error) throw reloaded
      expect(cloudflaredReadStatus(reloaded, paths).configured).toBe(true)
    })
  })
})
