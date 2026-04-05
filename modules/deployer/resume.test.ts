import { describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Config } from '@jib/config'
import { createLogger, getPaths } from '@jib/core'
import { Store, emptyState } from '@jib/state'
import { Engine } from './engine.ts'
import { resume } from './resume.ts'

describe('resume', () => {
  test('clears consecutive_failures and pinned', async () => {
    const root = await mkdtemp(join(tmpdir(), 'jib-root-'))
    await mkdir(join(root, 'state'), { recursive: true })
    const paths = getPaths(root)
    const store = new Store(paths.stateDir)
    const s = emptyState('demo')
    s.consecutive_failures = 3
    s.pinned = true
    await store.save('demo', s)

    const cfg: Config = {
      config_version: 3,
      poll_interval: '5m',
      apps: {},
    } as Config
    const engine = new Engine({ config: cfg, paths, store, log: createLogger('test') })
    await resume(engine, { app: 'demo' })
    const after = await store.load('demo')
    expect(after.consecutive_failures).toBe(0)
    expect(after.pinned).toBe(false)
  })
})
