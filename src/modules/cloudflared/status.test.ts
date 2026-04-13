import { describe, expect, test } from 'bun:test'
import type { Config } from '@jib/config'
import { cloudflaredReadStatus } from './status.ts'

function configWith(tunnel?: Config['tunnel']): Config {
  return { config_version: 3, poll_interval: '5m', modules: {}, sources: {}, apps: {}, tunnel }
}

describe('cloudflaredReadStatus', () => {
  test('reports an unconfigured tunnel when config is absent', () => {
    expect(cloudflaredReadStatus(configWith())).toEqual({
      configured: false,
      tunnelId: null,
      accountId: null,
    })
  })

  test('normalizes configured cloudflare metadata', () => {
    expect(
      cloudflaredReadStatus(
        configWith({ provider: 'cloudflare', tunnel_id: 'tun-123', account_id: 'acct-456' }),
      ),
    ).toEqual({ configured: true, tunnelId: 'tun-123', accountId: 'acct-456' })
  })
})
