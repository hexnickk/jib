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

  test('StringOrSlice normalizes string → string[]', () => {
    const cfg = ConfigSchema.parse({
      ...minimal,
      apps: {
        web: { ...minimal.apps.web, compose: 'docker-compose.yml' },
      },
    })
    expect(cfg.apps.web?.compose).toEqual(['docker-compose.yml'])
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

  test('defaults missing domains to empty list', () => {
    const cfg = ConfigSchema.parse({
      config_version: 3,
      apps: { worker: { repo: 'x' } },
    })
    expect(cfg.apps.worker?.domains).toEqual([])
  })
})
