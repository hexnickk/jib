import { describe, expect, test } from 'bun:test'
import { mkdtemp, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SecretsManager } from './manager.ts'

async function withMgr<T>(fn: (mgr: SecretsManager, dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), 'jib-secrets-'))
  try {
    return await fn(new SecretsManager(dir), dir)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

describe('SecretsManager', () => {
  test('set copies file and enforces 0600/0700', async () => {
    await withMgr(async (mgr, dir) => {
      const src = join(dir, 'source.env')
      await writeFile(src, 'FOO=bar\n', { mode: 0o644 })
      const dst = await mgr.set('web', src)
      expect(dst).toBe(join(dir, 'web', '.env'))

      const fileInfo = await stat(dst)
      expect(fileInfo.mode & 0o777).toBe(0o600)

      const dirInfo = await stat(join(dir, 'web'))
      expect(dirInfo.mode & 0o777).toBe(0o700)
    })
  })

  test('set honors custom env file name', async () => {
    await withMgr(async (mgr, dir) => {
      const src = join(dir, 'source.env')
      await writeFile(src, 'X=1\n')
      const dst = await mgr.set('web', src, '.env.prod')
      expect(dst.endsWith('/web/.env.prod')).toBe(true)
    })
  })

  test('check reports existence', async () => {
    await withMgr(async (mgr, dir) => {
      const src = join(dir, 'source.env')
      await writeFile(src, 'A=1')
      await mgr.set('web', src)
      expect((await mgr.check('web')).exists).toBe(true)
      expect((await mgr.check('ghost')).exists).toBe(false)
    })
  })

  test('checkAll returns sorted status', async () => {
    await withMgr(async (mgr, dir) => {
      const src = join(dir, 'source.env')
      await writeFile(src, 'A=1')
      await mgr.set('web', src)
      const results = await mgr.checkAll({
        worker: { env_file: '.env' },
        web: { env_file: '.env' },
      })
      expect(results.map((r) => r.app)).toEqual(['web', 'worker'])
      expect(results[0]?.exists).toBe(true)
      expect(results[1]?.exists).toBe(false)
    })
  })

  test('overwrite replaces contents', async () => {
    await withMgr(async (mgr, dir) => {
      const src = join(dir, 'source.env')
      await writeFile(src, 'V=1')
      await mgr.set('web', src)
      await writeFile(src, 'V=2')
      const dst = await mgr.set('web', src)
      expect(await Bun.file(dst).text()).toBe('V=2')
    })
  })
})
