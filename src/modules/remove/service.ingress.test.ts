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
    demo: {
      repo: 'owner/demo',
      branch: 'main',
      domains: [{ host: 'demo.example.com', port: 3000 }],
      env_file: '.env',
    },
  },
}

describe('RemoveService ingress cleanup', () => {
  test('attempts ingress release before removal and warns on failure', async () => {
    const warnings: string[] = []
    const calls: string[] = []
    const support: RemoveSupport = {
      releaseIngress: async () => {
        calls.push('releaseIngress')
        throw new Error('nginx reload failed')
      },
      stopApp: async () => {
        calls.push('stopApp')
      },
      removeCheckout: async () => {
        calls.push('removeCheckout')
      },
      removeSecrets: async () => {
        calls.push('removeSecrets')
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
      writeConfig: async () => {
        calls.push('writeConfig')
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
      'releaseIngress',
      'stopApp',
      'writeConfig',
      'removeCheckout',
      'removeSecrets',
      'removeState',
      'removeOverride',
      'removeManagedCompose',
    ])
    expect(warnings).toEqual(['ingress release: nginx reload failed'])
  })
})
