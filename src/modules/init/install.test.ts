import { describe, expect, test } from 'bun:test'
import type { Config } from '@jib/config'
import { loggingCreateLogger } from '@jib/logging'
import { getPaths } from '@jib/paths'
import { InitModuleInstallError } from './errors.ts'
import { runInstallsTx, runInstallsTxResult } from './install.ts'
import type { ModLike } from './registry.ts'
import type { InitContext } from './types.ts'

/**
 * Covers the transactional semantics of the optional-module install loop.
 * On any failure, already-installed modules must have their `uninstall()`
 * called in reverse order. Each rollback step is independent — a failing
 * uninstall doesn't abort the rest.
 */

const ctx: InitContext = {
  config: { config_version: 3, poll_interval: '5m', sources: {}, apps: {} } as Config,
  logger: loggingCreateLogger('init-test'),
  paths: getPaths('/tmp/jib-init-test'),
}

function mod(
  name: string,
  install?: ModLike['install'],
  uninstall?: ModLike['uninstall'],
): ModLike {
  const result: ModLike = { manifest: { name } }
  if (install) result.install = install
  if (uninstall) result.uninstall = uninstall
  return result
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

    const error = await runInstallsTxResult(mods, ctx)

    expect(error).toBeInstanceOf(InitModuleInstallError)
    expect(error?.message).toBe('c blew up')
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

    const error = await runInstallsTxResult(mods, ctx)

    expect(error).toBeInstanceOf(InitModuleInstallError)
    expect(error?.message).toBe('c blew up')
    expect(log).toEqual(['install:a', 'install:b', 'uninstall:b:fail', 'uninstall:a'])
  })

  test('module with no install() is skipped and not added to the installed set', async () => {
    const log: string[] = []
    const mods = [
      mod('noop'),
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

    const error = await runInstallsTxResult(mods, ctx)

    expect(error).toBeInstanceOf(InitModuleInstallError)
    expect(error?.message).toBe('c blew up')
    expect(log).toEqual(['install:b', 'uninstall:b'])
  })

  test('module with no uninstall() is left in place with a warning', async () => {
    const log: string[] = []
    const mods = [
      mod('a', async () => {
        log.push('install:a')
      }),
      mod('b', async () => {
        throw new Error('b blew up')
      }),
    ]

    const error = await runInstallsTxResult(mods, ctx)

    expect(error).toBeInstanceOf(InitModuleInstallError)
    expect(error?.message).toBe('b blew up')
    expect(log).toEqual(['install:a'])
  })

  test('throwing wrapper preserves the typed install error', async () => {
    const mods = [
      mod('broken', async () => {
        throw new Error('broken install')
      }),
    ]

    await expect(runInstallsTx(mods, ctx)).rejects.toBeInstanceOf(InitModuleInstallError)
  })
})
