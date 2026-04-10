import { describe, expect, test } from 'bun:test'
import { ConfigSchema } from './schema.ts'

const minimal = {
  config_version: 3,
  apps: {
    web: {
      repo: 'hexnickk/web',
      domains: [{ host: 'example.com', port: 8080 }],
    },
  },
}

describe('ConfigSchema', () => {
  test('valid minimal config', () => {
    const cfg = ConfigSchema.parse(minimal)
    expect(cfg.config_version).toBe(3)
    expect(cfg.poll_interval).toBe('5m')
    expect(cfg.apps.web?.branch).toBe('main')
    expect(cfg.apps.web?.env_file).toBe('.env')
  })

  test('rejects non-positive config_version', () => {
    expect(() => ConfigSchema.parse({ ...minimal, config_version: 0 })).toThrow()
    expect(() => ConfigSchema.parse({ ...minimal, config_version: -1 })).toThrow()
    expect(() => ConfigSchema.parse({ ...minimal, config_version: 'abc' })).toThrow()
  })

  test('StringOrSlice normalizes string → string[]', () => {
    const cfg = ConfigSchema.parse({
      ...minimal,
      apps: {
        web: { ...minimal.apps.web, compose: 'docker-compose.yml' },
      },
    })
    expect(cfg.apps.web?.compose).toEqual(['docker-compose.yml'])
  })

  test('StringOrSlice preserves array', () => {
    const cfg = ConfigSchema.parse({
      ...minimal,
      apps: {
        web: { ...minimal.apps.web, compose: ['a.yml', 'b.yml'] },
      },
    })
    expect(cfg.apps.web?.compose).toEqual(['a.yml', 'b.yml'])
  })

  test('full config with tunnel + github', () => {
    const cfg = ConfigSchema.parse({
      config_version: 3,
      poll_interval: '2m',
      sources: { prod: { driver: 'github', type: 'app', app_id: 12345 } },
      tunnel: { provider: 'cloudflare', tunnel_id: 'abc', account_id: 'def' },
      apps: {
        web: {
          repo: 'hexnickk/web',
          source: 'prod',
          domains: [{ host: 'example.com', port: 8080, ingress: 'cloudflare-tunnel' }],
          health: [{ path: '/health', port: 8080 }],
        },
      },
    })
    expect(cfg.sources.prod?.app_id).toBe(12345)
    expect(cfg.tunnel?.provider).toBe('cloudflare')
  })

  test('domain port is optional at parse time', () => {
    const cfg = ConfigSchema.parse({
      config_version: 3,
      apps: {
        web: {
          repo: 'hexnickk/web',
          domains: [{ host: 'example.com' }],
        },
      },
    })
    expect(cfg.apps.web?.domains[0]?.port).toBeUndefined()
    expect(cfg.apps.web?.domains[0]?.host).toBe('example.com')
  })

  test('accepts app with explicit zero-domain ingress', () => {
    const cfg = ConfigSchema.parse({
      config_version: 3,
      apps: { worker: { repo: 'x', domains: [] } },
    })
    expect(cfg.apps.worker?.domains).toEqual([])
  })

  test('defaults missing domains to empty list', () => {
    const cfg = ConfigSchema.parse({
      config_version: 3,
      apps: { worker: { repo: 'x' } },
    })
    expect(cfg.apps.worker?.domains).toEqual([])
  })
})
