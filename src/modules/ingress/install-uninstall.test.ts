import type { Logger } from '@jib/logging'
import { pathsGetPaths } from '@jib/paths'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

const logger = {
  info() {},
  warn() {},
  error() {},
  success() {},
  debug() {},
  box() {},
} as unknown as Logger

beforeEach(() => {
  vi.doUnmock('./backends/index.ts')
  vi.resetModules()
  vi.restoreAllMocks()
})

afterEach(() => {
  vi.doUnmock('./backends/index.ts')
  vi.resetModules()
  vi.restoreAllMocks()
})

describe('ingress install/uninstall delegation', () => {
  test('install forwards to the default backend hook', async () => {
    const calls: string[] = []
    vi.doMock('./backends/index.ts', () => ({
      ingressCreateOperator() {
        throw new Error('unused in test')
      },
      ingressDefaultBackend: () => ({
        install: async () => {
          calls.push('install')
        },
        createOperator() {
          throw new Error('unused in test')
        },
        name: 'fake',
      }),
    }))
    const { ingressInstall } = await import('./install.ts')

    await ingressInstall({
      config: { config_version: 3, poll_interval: '5m', modules: {}, sources: {}, apps: {} },
      logger,
      paths: pathsGetPaths('/tmp/jib-ingress'),
    })

    expect(calls).toEqual(['install'])
  })

  test('uninstall forwards to the default backend hook', async () => {
    const calls: string[] = []
    vi.doMock('./backends/index.ts', () => ({
      ingressCreateOperator() {
        throw new Error('unused in test')
      },
      ingressDefaultBackend: () => ({
        uninstall: async () => {
          calls.push('uninstall')
        },
        createOperator() {
          throw new Error('unused in test')
        },
        name: 'fake',
      }),
    }))
    const { ingressUninstall } = await import('./uninstall.ts')

    await ingressUninstall({
      config: { config_version: 3, poll_interval: '5m', modules: {}, sources: {}, apps: {} },
      logger,
      paths: pathsGetPaths('/tmp/jib-ingress'),
    })

    expect(calls).toEqual(['uninstall'])
  })
})
