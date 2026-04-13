import { describe, expect, test } from 'bun:test'
import * as watcher from './index.ts'

describe('watcher exports', () => {
  test('exposes prefixed APIs and compatibility aliases', () => {
    expect(watcher.manifest).toMatchObject({
      name: 'watcher',
      required: true,
      description: 'Git polling + autodeploy triggers',
    })
    expect(watcher.watcherInstall).toBe(watcher.install)
    expect(watcher.watcherInstallResult).toBe(watcher.installWatcher)
    expect(watcher.watcherUninstall).toBe(watcher.uninstall)
    expect(watcher.watcherUninstallResult).toBe(watcher.uninstallWatcher)
    expect(watcher.watcherRunPollCycle).toBe(watcher.runPollCycle)
    expect(watcher.watcherRunPoller).toBe(watcher.runPoller)
    expect(watcher.watcherPollApp).toBe(watcher.pollApp)
    expect(watcher.watcherParsePollInterval).toBe(watcher.parsePollInterval)
  })
})
