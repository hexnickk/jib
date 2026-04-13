import { describe, expect, test } from 'bun:test'
import { mkdtemp, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { secretsCreateManager } from './manager.ts'

async function withMgr<T>(
  fn: (mgr: ReturnType<typeof secretsCreateManager>, dir: string) => Promise<T>,
): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), 'jib-secrets-'))
  try {
    return await fn(secretsCreateManager(dir), dir)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

describe('secretsCreateManager', () => {
  test('upsert creates file and inserts key', async () => {
    await withMgr(async (mgr, dir) => {
      await mgr.upsert('web', 'FOO', 'bar')
      const content = await Bun.file(join(dir, 'web', '.env')).text()
      expect(content).toContain('FOO=bar')
      const info = await stat(join(dir, 'web', '.env'))
      expect(info.mode & 0o777).toBe(0o640)
    })
  })

  test('upsert updates existing key', async () => {
    await withMgr(async (mgr, dir) => {
      await mgr.upsert('web', 'FOO', 'bar')
      await mgr.upsert('web', 'FOO', 'baz')
      const content = await Bun.file(join(dir, 'web', '.env')).text()
      expect(content).toContain('FOO=baz')
      expect(content.match(/FOO=/g)?.length).toBe(1)
    })
  })

  test('upsert preserves other keys', async () => {
    await withMgr(async (mgr) => {
      await mgr.upsert('web', 'A', '1')
      await mgr.upsert('web', 'B', '2')
      await mgr.upsert('web', 'A', '3')
      const entries = await mgr.readMasked('web')
      expect(entries.map((e) => e.key)).toEqual(['A', 'B'])
    })
  })

  test('remove deletes a key', async () => {
    await withMgr(async (mgr) => {
      await mgr.upsert('web', 'A', '1')
      await mgr.upsert('web', 'B', '2')
      const removed = await mgr.remove('web', 'A')
      expect(removed).toBe(true)
      const entries = await mgr.readMasked('web')
      expect(entries.map((e) => e.key)).toEqual(['B'])
    })
  })

  test('remove returns false for missing key', async () => {
    await withMgr(async (mgr) => {
      const removed = await mgr.remove('web', 'NOPE')
      expect(removed).toBe(false)
    })
  })

  test('removeApp deletes the whole app secrets dir', async () => {
    await withMgr(async (mgr, dir) => {
      await mgr.upsert('web', 'A', '1')
      await mgr.removeApp('web')
      expect((await mgr.check('web')).exists).toBe(false)
      expect(await Bun.file(join(dir, 'web', '.env')).exists()).toBe(false)
    })
  })

  test('check reports existence', async () => {
    await withMgr(async (mgr) => {
      await mgr.upsert('web', 'A', '1')
      expect((await mgr.check('web')).exists).toBe(true)
      expect((await mgr.check('ghost')).exists).toBe(false)
    })
  })

  test('readMasked returns masked key-value pairs', async () => {
    await withMgr(async (mgr) => {
      await mgr.upsert('web', 'SECRET', 'longvalue')
      await mgr.upsert('web', 'SHORT', 'ab')
      const entries = await mgr.readMasked('web')
      expect(entries).toEqual([
        { key: 'SECRET', masked: 'lon***' },
        { key: 'SHORT', masked: '***' },
      ])
    })
  })

  test('upsert honors custom env file name', async () => {
    await withMgr(async (mgr, dir) => {
      await mgr.upsert('web', 'X', '1', '.env.prod')
      const path = join(dir, 'web', '.env.prod')
      const content = await Bun.file(path).text()
      expect(content).toContain('X=1')
    })
  })

  test('dir permissions are 0700', async () => {
    await withMgr(async (mgr, dir) => {
      await mgr.upsert('web', 'A', '1')
      const dirInfo = await stat(join(dir, 'web'))
      expect(dirInfo.mode & 0o777).toBe(0o750)
    })
  })
})
