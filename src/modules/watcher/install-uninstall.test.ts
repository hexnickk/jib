import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Logger } from '@jib/logging'
import { pathsGetPaths } from '@jib/paths'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { WatcherInstallEnableError } from './errors.ts'
import { watcherInstallResult } from './install.ts'
import { watcherUninstallResult } from './uninstall.ts'

const serviceName = 'jib-watcher.test.service'

const logger = {
  info() {},
  warn() {},
  error() {},
  success() {},
  debug() {},
  box() {},
} as unknown as Logger

let unitPath = ''
let testRoot = ''

beforeEach(async () => {
  testRoot = await mkdtemp(join(tmpdir(), 'jib-watcher-test-'))
  unitPath = join(testRoot, 'jib-watcher.service')
})

afterEach(async () => {
  await rm(testRoot, { recursive: true, force: true })
})

function labelCommand(args: readonly string[]): string {
  if (args.includes('daemon-reload')) return 'daemon-reload'
  if (args.includes('enable')) return 'enable'
  if (args.includes('disable')) return 'disable'
  return args.join(' ')
}

describe('watcher install/uninstall', () => {
  test('install writes the watcher unit and enables the service', async () => {
    const calls: string[] = []
    const root = await mkdtemp(join(tmpdir(), 'jib-watcher-'))

    try {
      expect(
        await watcherInstallResult(
          { logger, paths: pathsGetPaths(root) },
          {
            unitPath,
            serviceName,
            run: async (args) => {
              calls.push(labelCommand(args))
            },
          },
        ),
      ).toBeUndefined()

      expect(calls).toEqual(['daemon-reload', 'enable'])
      expect(await readFile(unitPath, 'utf8')).toContain(`Environment=JIB_ROOT=${root}`)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  test('watcherInstallResult returns a typed enable error', async () => {
    const calls: string[] = []
    const root = await mkdtemp(join(tmpdir(), 'jib-watcher-'))

    try {
      const error = await watcherInstallResult(
        { logger, paths: pathsGetPaths(root) },
        {
          unitPath,
          serviceName,
          run: async (args) => {
            const label = labelCommand(args)
            calls.push(label)
            if (label === 'enable') {
              return { exitCode: 1, stdout: '', stderr: 'enable boom' }
            }
          },
        },
      )

      expect(calls).toEqual(['daemon-reload', 'enable'])
      expect(error).toBeInstanceOf(WatcherInstallEnableError)
      expect(error?.message).toContain('enable boom')
      expect(await readFile(unitPath, 'utf8')).toContain(`Environment=JIB_ROOT=${root}`)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  test('uninstall disables the service, removes the unit, and reloads systemd', async () => {
    const calls: string[] = []
    await writeFile(unitPath, 'unit')

    expect(
      await watcherUninstallResult(
        { logger, paths: pathsGetPaths(testRoot) },
        {
          unitPath,
          serviceName,
          run: async (args) => {
            calls.push(labelCommand(args))
          },
        },
      ),
    ).toBeUndefined()

    expect(calls).toEqual(['disable', 'daemon-reload'])
    expect(await stat(unitPath).catch(() => null)).toBeNull()
  })
})
