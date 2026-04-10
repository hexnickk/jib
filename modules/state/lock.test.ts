import { describe, expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { LockError } from '@jib/core'
import { acquire } from './lock.ts'

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
      const release = await acquire(dir, 'app1')
      await release()
    })
  })

  test('non-blocking second acquisition fails', async () => {
    await withDir(async (dir) => {
      const release = await acquire(dir, 'app1')
      await expect(acquire(dir, 'app1', { blocking: false })).rejects.toThrow(LockError)
      await release()
    })
  })

  test('blocking acquisition times out', async () => {
    await withDir(async (dir) => {
      const release = await acquire(dir, 'app1')
      await expect(acquire(dir, 'app1', { blocking: true, timeoutMs: 1000 })).rejects.toThrow(
        LockError,
      )
      await release()
    })
  })

  test('second acquisition succeeds after release', async () => {
    await withDir(async (dir) => {
      const r1 = await acquire(dir, 'app1')
      await r1()
      const r2 = await acquire(dir, 'app1')
      await r2()
    })
  })
})
