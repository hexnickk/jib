import { describe, expect, test } from 'bun:test'
import * as watcher from './index.ts'

describe('watcher exports', () => {
  test('exposes only prefixed watcher APIs', () => {
    expect(watcher.manifest).toMatchObject({
      name: 'watcher',
      required: true,
      description: 'Git polling + autodeploy triggers',
    })
    expect(watcher.watcherInstallResult).toBeDefined()
    expect(watcher.watcherUninstallResult).toBeDefined()
    expect(watcher.watcherRunPollCycle).toBeDefined()
    expect(watcher.watcherRunPoller).toBeDefined()
    expect(watcher.watcherPollApp).toBeDefined()
    expect(watcher.watcherParsePollInterval).toBeDefined()
  })
})
