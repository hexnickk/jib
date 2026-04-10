import { describe, expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { StateError } from '@jib/core'
import { emptyState } from './schema.ts'
import { Store } from './store.ts'

async function withStore<T>(fn: (store: Store, dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), 'jib-state-'))
  try {
    return await fn(new Store(dir), dir)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

describe('Store', () => {
  test('load on missing file returns empty', async () => {
    await withStore(async (s) => {
      const st = await s.load('ghost')
      expect(st.app).toBe('ghost')
      expect(st.deployed_sha).toBe('')
    })
  })

  test('round-trip save + load', async () => {
    await withStore(async (s) => {
      const st = emptyState('web')
      st.deployed_sha = 'abc123'
      st.last_deploy_status = 'success'
      await s.save('web', st)
      const loaded = await s.load('web')
      expect(loaded.deployed_sha).toBe('abc123')
      expect(loaded.last_deploy_status).toBe('success')
      expect(loaded.schema_version).toBe(1)
    })
  })

  test('recordFailure writes last-deploy summary', async () => {
    await withStore(async (s) => {
      await s.save('web', emptyState('web'))
      await s.recordFailure('web', 'boom')
      const st = await s.load('web')
      expect(st.last_deploy_error).toBe('boom')
      expect(st.last_deploy_status).toBe('failure')
      expect(st.last_deploy).not.toBe('')
    })
  })

  test('remove deletes the app state file', async () => {
    await withStore(async (s) => {
      await s.save('web', emptyState('web'))
      await s.remove('web')
      const st = await s.load('web')
      expect(st.app).toBe('web')
      expect(st.deployed_sha).toBe('')
    })
  })

  test('load rejects corrupt JSON', async () => {
    await withStore(async (s, dir) => {
      await Bun.write(join(dir, 'web.json'), '{not json')
      await expect(s.load('web')).rejects.toThrow(StateError)
    })
  })
})
