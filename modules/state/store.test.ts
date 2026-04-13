import { describe, expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { StateError } from './errors.ts'
import { stateEmpty } from './schema.ts'
import { stateCreateStore, stateLoad, stateRecordFailure, stateRemove, stateSave } from './store.ts'

async function withStore<T>(
  fn: (store: ReturnType<typeof stateCreateStore>, dir: string) => Promise<T>,
): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), 'jib-state-'))
  try {
    return await fn(stateCreateStore(dir), dir)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

describe('state store', () => {
  test('load on missing file returns empty', async () => {
    await withStore(async (s) => {
      const st = await stateLoad(s, 'ghost')
      if (st instanceof Error) throw st
      expect(st.app).toBe('ghost')
      expect(st.deployed_sha).toBe('')
    })
  })

  test('round-trip save + load', async () => {
    await withStore(async (s) => {
      const st = stateEmpty('web')
      st.deployed_sha = 'abc123'
      st.last_deploy_status = 'success'
      expect(await stateSave(s, 'web', st)).toBeUndefined()
      const loaded = await stateLoad(s, 'web')
      if (loaded instanceof Error) throw loaded
      expect(loaded.deployed_sha).toBe('abc123')
      expect(loaded.last_deploy_status).toBe('success')
      expect(loaded.schema_version).toBe(1)
    })
  })

  test('recordFailure writes last-deploy summary', async () => {
    await withStore(async (s) => {
      expect(await stateSave(s, 'web', stateEmpty('web'))).toBeUndefined()
      expect(await stateRecordFailure(s, 'web', 'boom')).toBeUndefined()
      const st = await stateLoad(s, 'web')
      if (st instanceof Error) throw st
      expect(st.last_deploy_error).toBe('boom')
      expect(st.last_deploy_status).toBe('failure')
      expect(st.last_deploy).not.toBe('')
    })
  })

  test('remove deletes the app state file', async () => {
    await withStore(async (s) => {
      expect(await stateSave(s, 'web', stateEmpty('web'))).toBeUndefined()
      expect(await stateRemove(s, 'web')).toBeUndefined()
      const st = await stateLoad(s, 'web')
      if (st instanceof Error) throw st
      expect(st.app).toBe('web')
      expect(st.deployed_sha).toBe('')
    })
  })

  test('load rejects corrupt JSON', async () => {
    await withStore(async (s, dir) => {
      await Bun.write(join(dir, 'web.json'), '{not json')
      expect(await stateLoad(s, 'web')).toBeInstanceOf(StateError)
    })
  })
})

describe('loadState', () => {
  test('returns typed error for corrupt JSON', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'jib-state-'))
    try {
      await Bun.write(join(dir, 'web.json'), '{not json')
      const state = await stateLoad(stateCreateStore(dir), 'web')
      expect(state).toBeInstanceOf(StateError)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test('saveState returns typed error when the state dir cannot be created', async () => {
    const root = await mkdtemp(join(tmpdir(), 'jib-state-'))
    const blockedDir = join(root, 'blocked')
    try {
      await Bun.write(blockedDir, 'not a directory')
      const error = await stateSave(stateCreateStore(blockedDir), 'web', stateEmpty('web'))
      expect(error).toBeInstanceOf(StateError)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})
