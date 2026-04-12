import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Logger } from '@jib/logging'
import { getPaths } from '@jib/paths'

const unitPath = '/tmp/jib-watcher.test.service'
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

const logger = {
  info() {},
  warn() {},
  error() {},
  success() {},
  debug() {},
  box() {},
} as unknown as Logger

beforeEach(() => {
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
  await rm(unitPath, { force: true })
})

describe('watcher install/uninstall', () => {
  test('install writes the watcher unit and enables the service', async () => {
    const calls: string[] = []
    ;(Bun as typeof Bun & { $: typeof Bun.$ }).$ = (() => {
      calls.push(calls.length === 0 ? 'daemon-reload' : 'enable')
      return fakeShell()
    }) as unknown as typeof Bun.$
    const { install } = await import('./install.ts')
    const root = await mkdtemp(join(tmpdir(), 'jib-watcher-'))

    await install({ logger, paths: getPaths(root) })

    expect(calls).toEqual(['daemon-reload', 'enable'])
    expect(await readFile(unitPath, 'utf8')).toContain(`Environment=JIB_ROOT=${root}`)
    await rm(root, { recursive: true, force: true })
  })

  test('uninstall disables the service, removes the unit, and reloads systemd', async () => {
    const calls: string[] = []
    ;(Bun as typeof Bun & { $: typeof Bun.$ }).$ = (() => {
      calls.push(calls.length === 0 ? 'disable' : 'daemon-reload')
      return fakeShell()
    }) as unknown as typeof Bun.$
    const { uninstall } = await import('./uninstall.ts')
    await Bun.write(unitPath, 'unit')

    await uninstall({ logger, paths: getPaths('/tmp/jib-watcher-root') })

    expect(calls).toEqual(['disable', 'daemon-reload'])
    expect(await Bun.file(unitPath).exists()).toBe(false)
  })
})
