import type { Config } from '@jib/config'
import { InternalError, NotFoundError } from '@jib/errors'
import { describe, expect, test } from 'vitest'
import { removeApp } from './service.ts'
import type { RemoveSupport } from './types.ts'

const cfg: Config = {
  config_version: 3,
  poll_interval: '5m',
  modules: {},
  sources: {},
  apps: {
    demo: { repo: 'owner/demo', branch: 'main', domains: [] },
  },
}

describe('removeApp', () => {
  test('best-effort steps warn and config removal still lands', async () => {
    const warnings: string[] = []
    const calls: string[] = []
    let written: Config | undefined
    const support: RemoveSupport = {
      releaseIngress: async () => {
        calls.push('releaseIngress')
        return new InternalError('boom')
      },
      stopApp: async () => {
        calls.push('stopApp')
        return new InternalError('down failed')
      },
      removeCheckout: async () => {
        calls.push('removeCheckout')
        return new InternalError('cleanup failed')
      },
      removeSecrets: async () => {
        calls.push('removeSecrets')
        return new InternalError('secret cleanup failed')
      },
      removeState: async () => {
        calls.push('removeState')
        return undefined
      },
      removeOverride: async () => {
        calls.push('removeOverride')
        return undefined
      },
      removeManagedCompose: async () => {
        calls.push('removeManagedCompose')
        return undefined
      },
      writeConfig: async (_configFile, nextCfg): Promise<undefined> => {
        calls.push('writeConfig')
        written = nextCfg
        return undefined
      },
    }

    const result = await removeApp(
      {
        support,
        observer: { warn: (message) => warnings.push(message) },
      },
      {
        appName: 'demo',
        cfg,
        configFile: '/tmp/config.yml',
        quiet: true,
      },
    )

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

  test('best-effort steps also downgrade thrown custom-support failures', async () => {
    const warnings: string[] = []
    const demo = cfg.apps.demo
    if (!demo) {
      throw new Error('expected demo app')
    }
    const support: RemoveSupport = {
      releaseIngress: async () => {
        throw new Error('thrown ingress failure')
      },
      stopApp: async () => undefined,
      removeCheckout: async () => undefined,
      removeSecrets: async () => undefined,
      removeState: async () => undefined,
      removeOverride: async () => undefined,
      removeManagedCompose: async () => undefined,
      writeConfig: async () => undefined,
    }

    const result = await removeApp(
      { support, observer: { warn: (message) => warnings.push(message) } },
      {
        appName: 'demo',
        cfg: {
          ...cfg,
          apps: {
            demo: {
              ...demo,
              domains: [{ host: 'demo.example.com', port: 3000 }],
            },
          },
        },
        configFile: '/tmp/config.yml',
        quiet: true,
      },
    )

    expect(result).toEqual({ app: 'demo', removed: true })
    expect(warnings).toContain('ingress release: thrown ingress failure')
  })

  test('returns a typed error when the app does not exist', async () => {
    const support: RemoveSupport = {
      releaseIngress: async () => undefined,
      stopApp: async () => undefined,
      removeCheckout: async () => undefined,
      removeSecrets: async () => undefined,
      removeState: async () => undefined,
      removeOverride: async () => undefined,
      removeManagedCompose: async () => undefined,
      writeConfig: async () => undefined,
    }

    const result = await removeApp(
      { support },
      {
        appName: 'missing',
        cfg,
        configFile: '/tmp/config.yml',
        quiet: true,
      },
    )

    expect(result).toBeInstanceOf(NotFoundError)
    expect((result as NotFoundError).code).toBe('not_found')
  })

  test('returns a typed config write error from the primary API', async () => {
    const support: RemoveSupport = {
      releaseIngress: async () => undefined,
      stopApp: async () => undefined,
      removeCheckout: async () => undefined,
      removeSecrets: async () => undefined,
      removeState: async () => undefined,
      removeOverride: async () => undefined,
      removeManagedCompose: async () => undefined,
      writeConfig: async (configFile) =>
        new InternalError(`failed to write config "${configFile}" during remove`, {
          cause: new Error('disk full'),
        }),
    }

    const result = await removeApp(
      { support },
      {
        appName: 'demo',
        cfg,
        configFile: '/tmp/config.yml',
        quiet: true,
      },
    )

    expect(result).toBeInstanceOf(InternalError)
    expect((result as InternalError).code).toBe('internal')
  })

  test('returns a typed config write error without throwing', async () => {
    const support: RemoveSupport = {
      releaseIngress: async () => undefined,
      stopApp: async () => undefined,
      removeCheckout: async () => undefined,
      removeSecrets: async () => undefined,
      removeState: async () => undefined,
      removeOverride: async () => undefined,
      removeManagedCompose: async () => undefined,
      writeConfig: async (configFile) =>
        new InternalError(`failed to write config "${configFile}" during remove`),
    }

    expect(
      await removeApp(
        { support },
        {
          appName: 'demo',
          cfg,
          configFile: '/tmp/config.yml',
          quiet: true,
        },
      ),
    ).toBeInstanceOf(InternalError)
  })
})
