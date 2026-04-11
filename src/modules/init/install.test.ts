import { describe, expect, test } from 'bun:test'
import type { Config } from '@jib/config'
import { type ModuleContext, createLogger, getPaths } from '@jib/core'
import { runInstallsTx } from './install.ts'
import type { ModLike } from './registry.ts'

/**
 * Covers the transactional semantics of the optional-module install loop.
 * On any failure, already-installed modules must have their `uninstall()`
 * called in reverse order. Each rollback step is independent — a failing
 * uninstall doesn't abort the rest.
 */

const ctx: ModuleContext<Config> = {
  config: { config_version: 3, poll_interval: '5m', sources: {}, apps: {} } as Config,
  logger: createLogger('init-test'),
  paths: getPaths('/tmp/jib-init-test'),
}

function mod(
  name: string,
  install: ModLike['install'] = async () => undefined,
  uninstall?: ModLike['uninstall'],
): ModLike {
  const m: ModLike = { manifest: { name }, install }
  if (uninstall) m.uninstall = uninstall
  return m
}

describe('runInstallsTx', () => {
  test('happy path: every module installs in order', async () => {
    const log: string[] = []
    const mods = [
      mod('a', async () => {
        log.push('install:a')
      }),
      mod('b', async () => {
        log.push('install:b')
      }),
      mod('c', async () => {
        log.push('install:c')
      }),
    ]
    await runInstallsTx(mods, ctx)
    expect(log).toEqual(['install:a', 'install:b', 'install:c'])
  })

  test('failure mid-sequence: previously installed modules roll back in reverse', async () => {
    const log: string[] = []
    const mods = [
      mod(
        'a',
        async () => {
          log.push('install:a')
        },
        async () => {
          log.push('uninstall:a')
        },
      ),
      mod(
        'b',
        async () => {
          log.push('install:b')
        },
        async () => {
          log.push('uninstall:b')
        },
      ),
      mod(
        'c',
        async () => {
          log.push('install:c')
          throw new Error('c blew up')
        },
        async () => {
          log.push('uninstall:c')
        },
      ),
      mod('d', async () => {
        log.push('install:d')
      }),
    ]
    await expect(runInstallsTx(mods, ctx)).rejects.toThrow('c blew up')
    // c failed mid-install, so only a and b are "installed". d never ran.
    // Rollback visits b then a, in reverse.
    expect(log).toEqual(['install:a', 'install:b', 'install:c', 'uninstall:b', 'uninstall:a'])
  })

  test('failing uninstall in the rollback chain does not abort the rest', async () => {
    const log: string[] = []
    const mods = [
      mod(
        'a',
        async () => {
          log.push('install:a')
        },
        async () => {
          log.push('uninstall:a')
        },
      ),
      mod(
        'b',
        async () => {
          log.push('install:b')
        },
        async () => {
          log.push('uninstall:b:fail')
          throw new Error('b cannot be uninstalled')
        },
      ),
      mod('c', async () => {
        throw new Error('c blew up')
      }),
    ]
    await expect(runInstallsTx(mods, ctx)).rejects.toThrow('c blew up')
    expect(log).toEqual(['install:a', 'install:b', 'uninstall:b:fail', 'uninstall:a'])
  })

  test('module with no install() is skipped and not added to the installed set', async () => {
    const log: string[] = []
    const mods = [
      mod('noop'), // no real install
      mod(
        'b',
        async () => {
          log.push('install:b')
        },
        async () => {
          log.push('uninstall:b')
        },
      ),
      mod('c', async () => {
        throw new Error('c blew up')
      }),
    ]
    await expect(runInstallsTx(mods, ctx)).rejects.toThrow('c blew up')
    // `noop` had no install so it isn't in the installed set; only `b` rolls back.
    expect(log).toEqual(['install:b', 'uninstall:b'])
  })

  test('module with no uninstall() is left in place with a warning', async () => {
    const log: string[] = []
    const mods = [
      mod('a', async () => {
        log.push('install:a')
      }), // no uninstall
      mod('b', async () => {
        throw new Error('b blew up')
      }),
    ]
    await expect(runInstallsTx(mods, ctx)).rejects.toThrow('b blew up')
    // `a` has no uninstall so nothing happens during rollback for it.
    expect(log).toEqual(['install:a'])
  })
})
