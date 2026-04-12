import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Logger } from '@jib/logging'
import { getPaths } from '@jib/paths'
import { install } from './install.ts'
import { uninstall } from './uninstall.ts'

const serviceName = 'jib-cloudflared.test.service'

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
})

afterEach(async () => {
  await rm(testRoot, { recursive: true, force: true })
})

describe('cloudflared install/uninstall', () => {
  test('install writes managed files and triggers daemon reload', async () => {
    const calls: string[] = []
    const root = await mkdtemp(join(tmpdir(), 'jib-cloudflared-'))
    const paths = getPaths(root)

    try {
      await install(
        { logger, paths },
        {
          unitPath,
          composeYaml: ({ tunnelEnvPath }) => `env_file:\n  - ${tunnelEnvPath}\n`,
          systemdUnit: ({ cloudflaredDir }) => `ExecStart=${cloudflaredDir}\n`,
          daemonReload: async () => {
            calls.push('daemon-reload')
          },
        },
      )

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
    const root = await mkdtemp(join(tmpdir(), 'jib-cloudflared-'))
    const paths = getPaths(root)

    try {
      await mkdir(paths.cloudflaredDir, { recursive: true })
      await Bun.write(
        join(paths.cloudflaredDir, 'docker-compose.yml'),
        'services:\n  cloudflared:\n',
      )
      await Bun.write(unitPath, 'unit')

      await uninstall(
        { logger, paths },
        {
          serviceName,
          unitPath,
          disableNow: async () => {
            calls.push('disable')
          },
          daemonReload: async () => {
            calls.push('daemon-reload')
          },
        },
      )

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
