import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { InternalError } from '@jib/errors'
import { describe, expect, test } from 'vitest'
import { stateEmpty } from './schema.ts'
import { stateCreateStore, stateLoad, stateRecordFailure, stateRemove, stateSave } from './store.ts'

async function withStore<Value>(
  fn: (store: ReturnType<typeof stateCreateStore>, dir: string) => Promise<Value>,
): Promise<Value> {
  const dir = await mkdtemp(join(tmpdir(), 'jib-state-'))
  try {
    return await fn(stateCreateStore(dir), dir)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

describe('state store', () => {
  test('load on missing file returns empty', async () => {
    await withStore(async (store) => {
      const st = await stateLoad(store, 'ghost')
      if (st instanceof Error) {
        throw st
      }
      expect(st.app).toBe('ghost')
      expect(st.deployed_sha).toBe('')
    })
  })

  test('round-trip save + load', async () => {
    await withStore(async (store) => {
      const st = stateEmpty('web')
      st.deployed_sha = 'abc123'
      st.last_deploy_status = 'success'
      expect(await stateSave(store, 'web', st)).toBeUndefined()
      const loaded = await stateLoad(store, 'web')
      if (loaded instanceof Error) {
        throw loaded
      }
      expect(loaded.deployed_sha).toBe('abc123')
      expect(loaded.last_deploy_status).toBe('success')
      expect(loaded.schema_version).toBe(1)
    })
  })

  test('recordFailure writes last-deploy summary', async () => {
    await withStore(async (store) => {
      expect(await stateSave(store, 'web', stateEmpty('web'))).toBeUndefined()
      expect(await stateRecordFailure(store, 'web', 'boom')).toBeUndefined()
      const st = await stateLoad(store, 'web')
      if (st instanceof Error) {
        throw st
      }
      expect(st.last_deploy_error).toBe('boom')
      expect(st.last_deploy_status).toBe('failure')
      expect(st.last_deploy).not.toBe('')
    })
  })

  test('remove deletes the app state file', async () => {
    await withStore(async (store) => {
      expect(await stateSave(store, 'web', stateEmpty('web'))).toBeUndefined()
      expect(await stateRemove(store, 'web')).toBeUndefined()
      const st = await stateLoad(store, 'web')
      if (st instanceof Error) {
        throw st
      }
      expect(st.app).toBe('web')
      expect(st.deployed_sha).toBe('')
    })
  })

  test('load rejects corrupt JSON', async () => {
    await withStore(async (store, dir) => {
      await writeFile(join(dir, 'web.json'), '{not json')
      expect(await stateLoad(store, 'web')).toBeInstanceOf(InternalError)
    })
  })
})

describe('loadState', () => {
  test('returns typed error for corrupt JSON', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'jib-state-'))
    try {
      await writeFile(join(dir, 'web.json'), '{not json')
      const state = await stateLoad(stateCreateStore(dir), 'web')
      expect(state).toBeInstanceOf(InternalError)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test('saveState returns typed error when the state dir cannot be created', async () => {
    const root = await mkdtemp(join(tmpdir(), 'jib-state-'))
    const blockedDir = join(root, 'blocked')
    try {
      await writeFile(blockedDir, 'not a directory')
      const error = await stateSave(stateCreateStore(blockedDir), 'web', stateEmpty('web'))
      expect(error).toBeInstanceOf(InternalError)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})
