import { describe, expect, test } from 'bun:test'
import type { Config } from '@jib/config'
import type { ModuleContext, SetupHook } from '@jib/core'
import { createLogger, getPaths } from '@jib/core'
import { type HookEntry, runSetupHooks } from '../../setup-hooks.ts'

function makeEntry(
  name: string,
  order: number,
  fail: 'add' | 'remove' | null,
  log: string[],
): HookEntry {
  const hooks: SetupHook<Config> = {
    async onAppAdd(_c, _a) {
      log.push(`add:${name}`)
      if (fail === 'add') throw new Error(`${name} add boom`)
    },
    async onAppRemove(_c, _a) {
      log.push(`remove:${name}`)
      if (fail === 'remove') throw new Error(`${name} remove boom`)
    },
  }
  return { manifest: { name, installOrder: order }, hooks }
}

function ctx(): ModuleContext<Config> {
  return {
    config: { config_version: 3, poll_interval: '5m', apps: {} } as Config,
    logger: createLogger('test'),
    paths: getPaths('/tmp/jib-test'),
  }
}

describe('runSetupHooks', () => {
  test('add: runs ascending by installOrder', async () => {
    const log: string[] = []
    const reg = [makeEntry('nginx', 20, null, log), makeEntry('cf', 10, null, log)]
    await runSetupHooks(ctx(), 'myapp', 'add', reg)
    expect(log).toEqual(['add:cf', 'add:nginx'])
  })

  test('remove: runs descending by installOrder', async () => {
    const log: string[] = []
    const reg = [makeEntry('cf', 10, null, log), makeEntry('nginx', 20, null, log)]
    await runSetupHooks(ctx(), 'myapp', 'remove', reg)
    expect(log).toEqual(['remove:nginx', 'remove:cf'])
  })

  test('add: rolls back previously-completed hooks on failure', async () => {
    const log: string[] = []
    const reg = [makeEntry('cf', 10, null, log), makeEntry('nginx', 20, 'add', log)]
    await expect(runSetupHooks(ctx(), 'myapp', 'add', reg)).rejects.toThrow('nginx add boom')
    expect(log).toEqual(['add:cf', 'add:nginx', 'remove:cf'])
  })

  test('remove: logs errors and continues', async () => {
    const log: string[] = []
    const reg = [makeEntry('cf', 10, null, log), makeEntry('nginx', 20, 'remove', log)]
    await runSetupHooks(ctx(), 'myapp', 'remove', reg)
    expect(log).toEqual(['remove:nginx', 'remove:cf'])
  })

  test('default: missing installOrder sorts as 100', async () => {
    const log: string[] = []
    const a = makeEntry('a', 5, null, log)
    const b: HookEntry = { manifest: { name: 'b' }, hooks: makeEntry('b', 0, null, log).hooks }
    const c = makeEntry('c', 200, null, log)
    await runSetupHooks(ctx(), 'x', 'add', [c, b, a])
    expect(log).toEqual(['add:a', 'add:b', 'add:c'])
  })
})
