import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Logger } from '@jib/logging'
import { getPaths } from '@jib/paths'
import {
  CloudflaredInstallError,
  CloudflaredUninstallError,
  cloudflaredInstall,
  cloudflaredUninstall,
} from './index.ts'

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
  test('cloudflaredInstall writes managed files and triggers daemon reload', async () => {
    const calls: string[] = []
    const root = await mkdtemp(join(tmpdir(), 'jib-cloudflared-'))
    const paths = getPaths(root)

    try {
      await cloudflaredInstall(
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

  test('cloudflaredUninstall disables the service, removes managed files, and reloads systemd', async () => {
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

      await cloudflaredUninstall(
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

  test('cloudflaredInstall wraps daemon reload failures with a typed error and cause', async () => {
    const root = await mkdtemp(join(tmpdir(), 'jib-cloudflared-'))
    const paths = getPaths(root)
    const cause = new Error('reload failed')

    try {
      await expect(
        cloudflaredInstall(
          { logger, paths },
          {
            unitPath,
            daemonReload: async () => {
              throw cause
            },
          },
        ),
      ).rejects.toMatchObject({
        cause,
        message: 'reload failed',
        name: 'CloudflaredInstallError',
      })
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  test('cloudflaredInstall does not double-wrap typed install errors', async () => {
    const root = await mkdtemp(join(tmpdir(), 'jib-cloudflared-'))
    const paths = getPaths(root)
    const error = new CloudflaredInstallError('already wrapped')

    try {
      await expect(
        cloudflaredInstall(
          { logger, paths },
          {
            unitPath,
            daemonReload: async () => {
              throw error
            },
          },
        ),
      ).rejects.toBe(error)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  test('cloudflaredUninstall wraps disable failures with a typed error', async () => {
    const root = await mkdtemp(join(tmpdir(), 'jib-cloudflared-'))
    const paths = getPaths(root)

    try {
      await expect(
        cloudflaredUninstall(
          { logger, paths },
          {
            unitPath,
            disableNow: async () => {
              throw new Error('disable failed')
            },
          },
        ),
      ).rejects.toBeInstanceOf(CloudflaredUninstallError)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})
