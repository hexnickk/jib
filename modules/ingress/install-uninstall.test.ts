import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'
import type { Logger } from '@jib/logging'
import { getPaths } from '@jib/paths'

const logger = {
  info() {},
  warn() {},
  error() {},
  success() {},
  debug() {},
  box() {},
} as unknown as Logger

beforeEach(() => {
  mock.restore()
})

afterEach(() => {
  mock.restore()
})

describe('ingress install/uninstall delegation', () => {
  test('install forwards to the default backend hook', async () => {
    const calls: string[] = []
    mock.module('./backends/index.ts', () => ({
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
      paths: getPaths('/tmp/jib-ingress'),
    })

    expect(calls).toEqual(['install'])
  })

  test('uninstall forwards to the default backend hook', async () => {
    const calls: string[] = []
    mock.module('./backends/index.ts', () => ({
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
      paths: getPaths('/tmp/jib-ingress'),
    })

    expect(calls).toEqual(['uninstall'])
  })
})
