import { describe, expect, test } from 'bun:test'
import type { Config } from '@jib/config'
import { SystemdServiceStartError, systemdStartConfiguredManagedServicesResult } from './index.ts'

function configWith(modules: Record<string, boolean>): Config {
  return { config_version: 3, poll_interval: '5m', modules, sources: {}, apps: {} } as Config
}

function result(exitCode = 0, stdout = '', stderr = '') {
  return { exitCode, stdout: Buffer.from(stdout), stderr: Buffer.from(stderr) }
}

describe('systemdStartConfiguredManagedServicesResult', () => {
  test('starts watcher and configured cloudflared service', async () => {
    const calls: string[] = []
    const error = await systemdStartConfiguredManagedServicesResult('/config.yml', {
      loadConfig: async () => configWith({ cloudflared: true }),
      run: async (args) => {
        calls.push(args.join(' '))
        return result()
      },
    })

    expect(error).toBeUndefined()
    expect(calls).toEqual([
      'systemctl cat jib-watcher.service',
      'systemctl enable --now jib-watcher.service',
      'systemctl cat jib-cloudflared.service',
      'systemctl enable --now jib-cloudflared.service',
    ])
  })

  test('does not start cloudflared when the optional module is disabled', async () => {
    const calls: string[] = []
    const error = await systemdStartConfiguredManagedServicesResult('/config.yml', {
      loadConfig: async () => configWith({ cloudflared: false }),
      run: async (args) => {
        calls.push(args.join(' '))
        return result()
      },
    })

    expect(error).toBeUndefined()
    expect(calls).toEqual([
      'systemctl cat jib-watcher.service',
      'systemctl enable --now jib-watcher.service',
    ])
  })

  test('returns a typed start error', async () => {
    const error = await systemdStartConfiguredManagedServicesResult('/config.yml', {
      loadConfig: async () => configWith({}),
      run: async (args) => {
        return args.join(' ') === 'systemctl enable --now jib-watcher.service'
          ? result(1, '', 'docker missing')
          : result()
      },
    })

    expect(error).toBeInstanceOf(SystemdServiceStartError)
    expect(error?.message).toContain('docker missing')
  })
})
