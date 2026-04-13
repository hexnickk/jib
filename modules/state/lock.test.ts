import { describe, expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { LockError } from './errors.ts'
import { stateAcquire, stateAcquireLock } from './lock.ts'

async function withDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), 'jib-lock-'))
  try {
    return await fn(dir)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

describe('acquire', () => {
  test('acquires and releases', async () => {
    await withDir(async (dir) => {
      const release = await stateAcquire(dir, 'app1')
      await release()
    })
  })

  test('non-blocking second acquisition fails', async () => {
    await withDir(async (dir) => {
      const release = await stateAcquire(dir, 'app1')
      await expect(stateAcquire(dir, 'app1', { blocking: false })).rejects.toThrow(LockError)
      await release()
    })
  })

  test('blocking acquisition times out', async () => {
    await withDir(async (dir) => {
      const release = await stateAcquire(dir, 'app1')
      await expect(stateAcquire(dir, 'app1', { blocking: true, timeoutMs: 1000 })).rejects.toThrow(
        LockError,
      )
      await release()
    })
  })

  test('second acquisition succeeds after release', async () => {
    await withDir(async (dir) => {
      const r1 = await stateAcquire(dir, 'app1')
      await r1()
      const r2 = await stateAcquire(dir, 'app1')
      await r2()
    })
  })
})

describe('acquireLock', () => {
  test('returns typed error when the lock is held', async () => {
    await withDir(async (dir) => {
      const release = await stateAcquire(dir, 'app1')
      const result = await stateAcquireLock(dir, 'app1', { blocking: false })
      expect(result).toBeInstanceOf(LockError)
      await release()
    })
  })

  test('returns typed error when the lock dir cannot be created', async () => {
    const root = await mkdtemp(join(tmpdir(), 'jib-lock-'))
    const blockedDir = join(root, 'blocked')
    try {
      await Bun.write(blockedDir, 'not a directory')
      const result = await stateAcquireLock(blockedDir, 'app1')
      expect(result).toBeInstanceOf(LockError)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})
