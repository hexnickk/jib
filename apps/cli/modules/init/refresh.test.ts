import { describe, expect, test } from 'bun:test'
import type { Config } from '@jib/config'
import { getPaths } from '@jib/core'
import { refreshExistingInstall } from './refresh.ts'

const paths = getPaths('/tmp/jib-init-refresh-test')
const baseConfig = { config_version: 3, poll_interval: '5m', sources: {}, apps: {} } as Config

describe('refreshExistingInstall', () => {
  test('restarts only active services when no unit refresh is requested', async () => {
    const calls: string[] = []

    const restarted = await refreshExistingInstall(
      baseConfig,
      paths,
      { reinstallUnits: false },
      {
        collectServices: async (hasTunnel) => {
          calls.push(`collect:${hasTunnel}`)
          return [{ name: 'jib-watcher', active: true, status: 'active' }]
        },
        reinstallModules: async () => {
          calls.push('reinstall')
        },
        restartService: async (name) => {
          calls.push(`restart:${name}`)
        },
      },
    )

    expect(restarted).toBe(1)
    expect(calls).toEqual(['collect:false', 'restart:jib-watcher'])
  })

  test('reinstalls enabled modules before restarting managed services', async () => {
    const calls: string[] = []
    const config = {
      ...baseConfig,
      modules: { cloudflared: true, github: true },
    } as Config

    const restarted = await refreshExistingInstall(
      config,
      paths,
      { reinstallUnits: true },
      {
        collectServices: async (hasTunnel) => {
          calls.push(`collect:${hasTunnel}`)
          return [{ name: 'jib-cloudflared', active: true, status: 'active' }]
        },
        reinstallModules: async (names, ctx) => {
          calls.push(`reinstall:${names.join(',')}`)
          expect(ctx.config).toBe(config)
          expect(ctx.paths).toEqual(paths)
        },
        restartService: async (name) => {
          calls.push(`restart:${name}`)
        },
      },
    )

    expect(restarted).toBe(1)
    expect(calls).toEqual([
      'reinstall:watcher,nginx,cloudflared,github',
      'collect:true',
      'restart:jib-cloudflared',
    ])
  })
})
