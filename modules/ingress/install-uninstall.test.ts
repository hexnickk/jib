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
      defaultIngressBackend: () => ({
        install: async () => {
          calls.push('install')
        },
        createOperator() {
          throw new Error('unused in test')
        },
        name: 'fake',
      }),
    }))
    const { install } = await import('./install.ts')

    await install({
      config: { config_version: 3, poll_interval: '5m', modules: {}, sources: {}, apps: {} },
      logger,
      paths: getPaths('/tmp/jib-ingress'),
    })

    expect(calls).toEqual(['install'])
  })

  test('uninstall forwards to the default backend hook', async () => {
    const calls: string[] = []
    mock.module('./backends/index.ts', () => ({
      defaultIngressBackend: () => ({
        uninstall: async () => {
          calls.push('uninstall')
        },
        createOperator() {
          throw new Error('unused in test')
        },
        name: 'fake',
      }),
    }))
    const { uninstall } = await import('./uninstall.ts')

    await uninstall({
      config: { config_version: 3, poll_interval: '5m', modules: {}, sources: {}, apps: {} },
      logger,
      paths: getPaths('/tmp/jib-ingress'),
    })

    expect(calls).toEqual(['uninstall'])
  })
})
