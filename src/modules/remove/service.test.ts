import { describe, expect, test } from 'bun:test'
import type { Config } from '@jib/config'
import { RemoveService } from './service.ts'
import type { RemoveSupport } from './types.ts'

const cfg: Config = {
  config_version: 3,
  poll_interval: '5m',
  modules: {},
  sources: {},
  apps: {
    demo: { repo: 'owner/demo', branch: 'main', domains: [], env_file: '.env' },
  },
}

describe('RemoveService', () => {
  test('best-effort steps warn and config removal still lands', async () => {
    const warnings: string[] = []
    const calls: string[] = []
    let written: Config | undefined
    const support: RemoveSupport = {
      releaseIngress: async () => {
        calls.push('releaseIngress')
        throw new Error('boom')
      },
      stopApp: async () => {
        calls.push('stopApp')
        throw new Error('down failed')
      },
      removeCheckout: async () => {
        calls.push('removeCheckout')
        throw new Error('cleanup failed')
      },
      removeSecrets: async () => {
        calls.push('removeSecrets')
        throw new Error('secret cleanup failed')
      },
      removeState: async () => {
        calls.push('removeState')
      },
      removeOverride: async () => {
        calls.push('removeOverride')
      },
      removeManagedCompose: async () => {
        calls.push('removeManagedCompose')
      },
      writeConfig: async (_configFile, nextCfg) => {
        calls.push('writeConfig')
        written = nextCfg
      },
    }

    const result = await new RemoveService(support, {
      warn: (message) => warnings.push(message),
    }).run({
      appName: 'demo',
      cfg,
      configFile: '/tmp/config.yml',
      quiet: true,
    })

    expect(result).toEqual({ app: 'demo', removed: true })
    expect(calls).toEqual([
      'stopApp',
      'writeConfig',
      'removeCheckout',
      'removeSecrets',
      'removeState',
      'removeOverride',
      'removeManagedCompose',
    ])
    expect(warnings).toEqual([
      'compose down: down failed',
      'repo cleanup: cleanup failed',
      'secrets cleanup: secret cleanup failed',
    ])
    expect(written?.apps.demo).toBeUndefined()
  })
})
