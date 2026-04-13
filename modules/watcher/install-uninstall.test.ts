import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Logger } from '@jib/logging'
import { getPaths } from '@jib/paths'
import { WatcherInstallEnableError } from './errors.ts'

const serviceName = 'jib-watcher.test.service'
const originalDollar = Bun.$

type ShellLike = Promise<{ exitCode: number; stdout: Buffer; stderr: Buffer }> & {
  quiet(): ShellLike
  nothrow(): ShellLike
}

function fakeShell(result = { exitCode: 0, stdout: Buffer.from(''), stderr: Buffer.from('') }) {
  const promise = Promise.resolve(result) as ShellLike
  promise.quiet = () => promise
  promise.nothrow = () => promise
  return promise
}

function fakeShellRejected(error: Error) {
  const promise = Promise.reject(error) as ShellLike
  promise.quiet = () => promise
  promise.nothrow = () => promise
  return promise
}

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
  mock.module('./templates.ts', () => ({
    UNIT_PATH: unitPath,
    SERVICE_NAME: serviceName,
    systemdUnit: ({ jibRoot }: { jibRoot: string }) => `Environment=JIB_ROOT=${jibRoot}\n`,
  }))
  ;(Bun as typeof Bun & { $: typeof Bun.$ }).$ = (() => fakeShell()) as unknown as typeof Bun.$
})

afterEach(async () => {
  mock.restore()
  ;(Bun as typeof Bun & { $: typeof Bun.$ }).$ = originalDollar
  await rm(testRoot, { recursive: true, force: true })
})

describe('watcher install/uninstall', () => {
  test('install writes the watcher unit and enables the service', async () => {
    const calls: string[] = []
    ;(Bun as typeof Bun & { $: typeof Bun.$ }).$ = (() => {
      calls.push(calls.length === 0 ? 'daemon-reload' : 'enable')
      return fakeShell()
    }) as unknown as typeof Bun.$
    const { watcherInstall } = await import('./install.ts')
    const root = await mkdtemp(join(tmpdir(), 'jib-watcher-'))

    try {
      await watcherInstall({ logger, paths: getPaths(root) })

      expect(calls).toEqual(['daemon-reload', 'enable'])
      expect(await readFile(unitPath, 'utf8')).toContain(`Environment=JIB_ROOT=${root}`)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  test('watcherInstallResult returns a typed enable error', async () => {
    const calls: string[] = []
    ;(Bun as typeof Bun & { $: typeof Bun.$ }).$ = (() => {
      calls.push(calls.length === 0 ? 'daemon-reload' : 'enable')
      return calls.length === 1 ? fakeShell() : fakeShellRejected(new Error('enable boom'))
    }) as unknown as typeof Bun.$
    const { watcherInstallResult } = await import('./install.ts')
    const root = await mkdtemp(join(tmpdir(), 'jib-watcher-'))

    try {
      const error = await watcherInstallResult({ logger, paths: getPaths(root) })

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
    ;(Bun as typeof Bun & { $: typeof Bun.$ }).$ = (() => {
      calls.push(calls.length === 0 ? 'disable' : 'daemon-reload')
      return fakeShell()
    }) as unknown as typeof Bun.$
    const { watcherUninstall } = await import('./uninstall.ts')
    await Bun.write(unitPath, 'unit')

    await watcherUninstall({ logger, paths: getPaths(testRoot) })

    expect(calls).toEqual(['disable', 'daemon-reload'])
    expect(await Bun.file(unitPath).exists()).toBe(false)
  })
})
