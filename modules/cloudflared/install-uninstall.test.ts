import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Logger } from '@jib/logging'
import { getPaths } from '@jib/paths'
import {
  CloudflaredInstallReloadError,
  CloudflaredInstallWriteUnitError,
  CloudflaredUninstallDisableError,
  cloudflaredInstallResult,
  cloudflaredUninstallResult,
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
  test('cloudflaredInstallResult writes managed files and triggers daemon reload', async () => {
    const calls: string[] = []
    const root = await mkdtemp(join(tmpdir(), 'jib-cloudflared-'))
    const paths = getPaths(root)

    try {
      const result = await cloudflaredInstallResult(
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

      expect(result).toBeUndefined()
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

  test('cloudflaredUninstallResult disables the service, removes managed files, and reloads systemd', async () => {
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

      const result = await cloudflaredUninstallResult(
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

      expect(result).toBeUndefined()
      expect(calls).toEqual(['disable', 'daemon-reload'])
      expect(await stat(unitPath).catch(() => null)).toBeNull()
      expect(
        await stat(join(paths.cloudflaredDir, 'docker-compose.yml')).catch(() => null),
      ).toBeNull()
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  test('cloudflaredInstallResult returns a typed reload error for non-zero daemon-reload exits', async () => {
    const root = await mkdtemp(join(tmpdir(), 'jib-cloudflared-'))
    const paths = getPaths(root)

    try {
      const result = await cloudflaredInstallResult(
        { logger, paths },
        {
          unitPath,
          daemonReload: async () => ({
            exitCode: 1,
            stdout: Buffer.from(''),
            stderr: Buffer.from('reload failed'),
          }),
        },
      )

      expect(result).toMatchObject({
        message: 'systemctl daemon-reload: reload failed',
        name: 'CloudflaredInstallReloadError',
      })
      expect(result).toBeInstanceOf(CloudflaredInstallReloadError)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  test('cloudflaredInstallResult returns typed unit write errors', async () => {
    const root = await mkdtemp(join(tmpdir(), 'jib-cloudflared-'))
    const paths = getPaths(root)

    try {
      const result = await cloudflaredInstallResult(
        { logger, paths },
        {
          unitPath,
          systemdUnit: () => {
            throw new Error('bad unit template')
          },
        },
      )

      expect(result).toBeInstanceOf(CloudflaredInstallWriteUnitError)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  test('cloudflaredUninstall keeps cleaning up when disable reports an absent unit', async () => {
    const root = await mkdtemp(join(tmpdir(), 'jib-cloudflared-'))
    const paths = getPaths(root)
    const calls: string[] = []

    try {
      await mkdir(paths.cloudflaredDir, { recursive: true })
      await Bun.write(
        join(paths.cloudflaredDir, 'docker-compose.yml'),
        'services:\n  cloudflared:\n',
      )
      await Bun.write(unitPath, 'unit')

      const result = await cloudflaredUninstallResult(
        { logger, paths },
        {
          serviceName,
          unitPath,
          disableNow: async () => {
            calls.push('disable')
            return {
              exitCode: 1,
              stdout: Buffer.from(''),
              stderr: Buffer.from('Unit jib-cloudflared.test.service not loaded.'),
            }
          },
          daemonReload: async () => {
            calls.push('daemon-reload')
          },
        },
      )

      expect(result).toBeUndefined()
      expect(calls).toEqual(['disable', 'daemon-reload'])
      expect(await stat(unitPath).catch(() => null)).toBeNull()
      expect(
        await stat(join(paths.cloudflaredDir, 'docker-compose.yml')).catch(() => null),
      ).toBeNull()
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  test('cloudflaredUninstallResult returns a typed disable error after cleanup on real failures', async () => {
    const root = await mkdtemp(join(tmpdir(), 'jib-cloudflared-'))
    const paths = getPaths(root)
    const calls: string[] = []

    try {
      await mkdir(paths.cloudflaredDir, { recursive: true })
      await Bun.write(
        join(paths.cloudflaredDir, 'docker-compose.yml'),
        'services:\n  cloudflared:\n',
      )
      await Bun.write(unitPath, 'unit')

      const result = await cloudflaredUninstallResult(
        { logger, paths },
        {
          serviceName,
          unitPath,
          disableNow: async () => {
            calls.push('disable')
            return {
              exitCode: 1,
              stdout: Buffer.from(''),
              stderr: Buffer.from('permission denied'),
            }
          },
          daemonReload: async () => {
            calls.push('daemon-reload')
          },
        },
      )

      expect(result).toBeInstanceOf(CloudflaredUninstallDisableError)
      expect(calls).toEqual(['disable', 'daemon-reload'])
      expect(await stat(unitPath).catch(() => null)).toBeNull()
      expect(
        await stat(join(paths.cloudflaredDir, 'docker-compose.yml')).catch(() => null),
      ).toBeNull()
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  test('cloudflaredUninstallResult returns a typed reload error for non-zero daemon-reload exits', async () => {
    const root = await mkdtemp(join(tmpdir(), 'jib-cloudflared-'))
    const paths = getPaths(root)

    try {
      await mkdir(paths.cloudflaredDir, { recursive: true })
      await Bun.write(
        join(paths.cloudflaredDir, 'docker-compose.yml'),
        'services:\n  cloudflared:\n',
      )

      const result = await cloudflaredUninstallResult(
        { logger, paths },
        {
          unitPath,
          disableNow: async () => undefined,
          daemonReload: async () => ({
            exitCode: 1,
            stdout: Buffer.from(''),
            stderr: Buffer.from('reload failed'),
          }),
        },
      )

      expect(result?.name).toBe('CloudflaredUninstallReloadError')
      expect(result?.message).toBe('systemctl daemon-reload: reload failed')
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  test('cloudflaredUninstallResult returns uninstall errors for thrown disable failures', async () => {
    const root = await mkdtemp(join(tmpdir(), 'jib-cloudflared-'))
    const paths = getPaths(root)

    try {
      const result = await cloudflaredUninstallResult(
        { logger, paths },
        {
          unitPath,
          disableNow: async () => {
            throw new Error('disable failed')
          },
        },
      )

      expect(result).toBeInstanceOf(CloudflaredUninstallDisableError)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})
