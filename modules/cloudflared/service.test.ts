import { describe, expect, test } from 'bun:test'
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { getPaths } from '@jib/paths'
import {
  enableCloudflaredService,
  hasTunnelToken,
  saveTunnelToken,
  tunnelTokenPath,
} from './service.ts'

async function withTmpPaths<T>(fn: (root: string) => Promise<T>): Promise<T> {
  const root = await mkdtemp(join(tmpdir(), 'jib-cloudflared-'))
  try {
    return await fn(root)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}

describe('cloudflared service helpers', () => {
  test('hasTunnelToken returns false before a token is saved', async () => {
    await withTmpPaths(async (root) => {
      expect(hasTunnelToken(getPaths(root))).toBe(false)
    })
  })

  test('saveTunnelToken writes the normalized env file', async () => {
    await withTmpPaths(async (root) => {
      const paths = getPaths(root)

      const saved = await saveTunnelToken(paths, 'cloudflared tunnel run --token eyJhIjoiNzQ')

      expect(saved).toBe(true)
      expect(hasTunnelToken(paths)).toBe(true)
      expect(await readFile(tunnelTokenPath(paths), 'utf8')).toBe('TUNNEL_TOKEN=eyJhIjoiNzQ\n')
      expect((await stat(join(root, 'secrets', '_jib', 'cloudflare'))).mode & 0o7777).toBe(0o2770)
    })
  })

  test('saveTunnelToken skips blank or invalid cloudflared commands', async () => {
    await withTmpPaths(async (root) => {
      const paths = getPaths(root)

      expect(await saveTunnelToken(paths, '')).toBe(false)
      expect(await saveTunnelToken(paths, 'cloudflared service install')).toBe(false)
      expect(hasTunnelToken(paths)).toBe(false)
    })
  })

  test('enableCloudflaredService reports shell failures without throwing', async () => {
    const result = await enableCloudflaredService({
      run: async () => ({
        exitCode: 1,
        stdout: Buffer.from(''),
        stderr: Buffer.from('permission denied'),
      }),
    })

    expect(result).toEqual({ ok: false, detail: 'permission denied' })
  })
})
