import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'
import { mkdir, mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Logger } from '@jib/logging'
import { getPaths } from '@jib/paths'

const serviceName = 'jib-cloudflared.test.service'
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

let unitPath = ''
let testRoot = ''

beforeEach(async () => {
  testRoot = await mkdtemp(join(tmpdir(), 'jib-cloudflared-test-'))
  unitPath = join(testRoot, 'jib-cloudflared.service')
  mock.module('./templates.ts', () => ({
    UNIT_PATH: unitPath,
    SERVICE_NAME: serviceName,
    composeYaml: ({ tunnelEnvPath }: { tunnelEnvPath: string }) =>
      `env_file:\n  - ${tunnelEnvPath}\n`,
    systemdUnit: ({ cloudflaredDir }: { cloudflaredDir: string }) =>
      `ExecStart=${cloudflaredDir}\n`,
  }))
  ;(Bun as typeof Bun & { $: typeof Bun.$ }).$ = (() => fakeShell()) as unknown as typeof Bun.$
})

afterEach(async () => {
  mock.restore()
  ;(Bun as typeof Bun & { $: typeof Bun.$ }).$ = originalDollar
  await rm(testRoot, { recursive: true, force: true })
})

describe('cloudflared install/uninstall', () => {
  test('install writes managed files and triggers daemon reload', async () => {
    const calls: string[] = []
    ;(Bun as typeof Bun & { $: typeof Bun.$ }).$ = (() => {
      calls.push('daemon-reload')
      return fakeShell()
    }) as unknown as typeof Bun.$
    const { install } = await import('./install.ts')
    const root = await mkdtemp(join(tmpdir(), 'jib-cloudflared-'))
    const paths = getPaths(root)

    try {
      await install({ logger, paths })

      expect(calls).toEqual(['daemon-reload'])
      expect(await readFile(join(paths.cloudflaredDir, 'docker-compose.yml'), 'utf8')).toContain(
        'env_file:',
      )
      expect(await readFile(unitPath, 'utf8')).toContain(paths.cloudflaredDir)
      expect((await stat(join(paths.cloudflaredDir, 'docker-compose.yml'))).mode & 0o777).toBe(
        0o644,
      )
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  test('uninstall disables the service, removes managed files, and reloads systemd', async () => {
    const calls: string[] = []
    ;(Bun as typeof Bun & { $: typeof Bun.$ }).$ = (() => {
      calls.push(calls.length === 0 ? 'disable' : 'daemon-reload')
      return fakeShell()
    }) as unknown as typeof Bun.$
    const { uninstall } = await import('./uninstall.ts')
    const root = await mkdtemp(join(tmpdir(), 'jib-cloudflared-'))
    const paths = getPaths(root)

    try {
      await mkdir(paths.cloudflaredDir, { recursive: true })
      await Bun.write(
        join(paths.cloudflaredDir, 'docker-compose.yml'),
        'services:\n  cloudflared:\n',
      )
      await Bun.write(unitPath, 'unit')

      await uninstall({ logger, paths })

      expect(calls).toEqual(['disable', 'daemon-reload'])
      expect(await stat(unitPath).catch(() => null)).toBeNull()
      expect(
        await stat(join(paths.cloudflaredDir, 'docker-compose.yml')).catch(() => null),
      ).toBeNull()
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})
