import { describe, expect, test } from 'bun:test'
import { ConfigError } from '@jib/core'
import { ConfigSchema } from './schema.ts'
import { parseDuration, validate, validateRepo } from './validate.ts'

describe('parseDuration', () => {
  test('parses seconds, minutes, hours', () => {
    expect(parseDuration('30s')).toBe(30_000)
    expect(parseDuration('5m')).toBe(300_000)
    expect(parseDuration('1h')).toBe(3_600_000)
  })
  test('parses compound durations', () => {
    expect(parseDuration('1h30m')).toBe(5_400_000)
  })
  test('accepts 0 and decimals', () => {
    expect(parseDuration('0s')).toBe(0)
    expect(parseDuration('1.5h')).toBe(5_400_000)
  })
  test('rejects bad input', () => {
    expect(parseDuration('')).toBeNull()
    expect(parseDuration('5')).toBeNull()
    expect(parseDuration('5x')).toBeNull()
    expect(parseDuration('abc')).toBeNull()
    expect(parseDuration('-5s')).toBeNull()
  })
})

const base = (overrides: Record<string, unknown> = {}) =>
  ConfigSchema.parse({
    config_version: 3,
    apps: {
      web: { repo: 'hexnickk/web', domains: [{ host: 'example.com', port: 80 }] },
    },
    ...overrides,
  })

describe('validateRepo', () => {
  test('accepts empty and "local"', () => {
    expect(validateRepo('')).toBeNull()
    expect(validateRepo('local')).toBeNull()
  })
  test('accepts owner/name', () => {
    expect(validateRepo('hexnickk/jib')).toBeNull()
  })
  test('accepts scheme URLs and git@host:path', () => {
    expect(validateRepo('file:///tmp/foo')).toBeNull()
    expect(validateRepo('https://example.com/foo.git')).toBeNull()
    expect(validateRepo('ssh://git@example.com/foo.git')).toBeNull()
    expect(validateRepo('git@github.com:owner/name.git')).toBeNull()
  })
  test('accepts absolute paths', () => {
    expect(validateRepo('/srv/repos/app')).toBeNull()
  })
  test('rejects path traversal', () => {
    expect(validateRepo('../../etc')).not.toBeNull()
    expect(validateRepo('owner/..')).not.toBeNull()
  })
  test('rejects too many slashes in slug', () => {
    expect(validateRepo('a/b/c')).not.toBeNull()
  })
  test('rejects random garbage', () => {
    expect(validateRepo('not a repo')).not.toBeNull()
  })
})

describe('validate', () => {
  test('accepts valid config', () => {
    expect(() => validate(base())).not.toThrow()
  })

  test('rejects invalid poll_interval', () => {
    expect(() => validate(base({ poll_interval: 'forever' }))).toThrow(ConfigError)
  })

  test('requires tunnel when domain uses cloudflare-tunnel', () => {
    const cfg = base({
      apps: {
        web: {
          repo: 'hexnickk/web',
          domains: [{ host: 'example.com', port: 80, ingress: 'cloudflare-tunnel' }],
        },
      },
    })
    expect(() => validate(cfg)).toThrow(/tunnel/)
  })

  test('accepts tunnel-ingress when tunnel config present', () => {
    const cfg = base({
      tunnel: { provider: 'cloudflare' },
      apps: {
        web: {
          repo: 'hexnickk/web',
          domains: [{ host: 'example.com', port: 80, ingress: 'cloudflare-tunnel' }],
        },
      },
    })
    expect(() => validate(cfg)).not.toThrow()
  })

  test('rejects app referencing unknown provider', () => {
    const cfg = base({
      apps: {
        web: {
          repo: 'hexnickk/web',
          provider: 'ghost',
          domains: [{ host: 'example.com', port: 80 }],
        },
      },
    })
    expect(() => validate(cfg)).toThrow(/provider/)
  })

  test('accepts app with matching provider', () => {
    const cfg = base({
      github: { providers: { prod: { type: 'key' } } },
      apps: {
        web: {
          repo: 'hexnickk/web',
          provider: 'prod',
          domains: [{ host: 'example.com', port: 80 }],
        },
      },
    })
    expect(() => validate(cfg)).not.toThrow()
  })

  test('rejects repo with ".." traversal', () => {
    const cfg = base({
      apps: {
        web: { repo: '../../etc/passwd', domains: [{ host: 'example.com', port: 80 }] },
      },
    })
    expect(() => validate(cfg)).toThrow(/repo/)
  })

  test('rejects repo with embedded slash beyond owner/name', () => {
    const cfg = base({
      apps: {
        web: { repo: 'a/b/c', domains: [{ host: 'example.com', port: 80 }] },
      },
    })
    expect(() => validate(cfg)).toThrow(/repo/)
  })

  test('accepts file:// repo', () => {
    const cfg = base({
      apps: {
        web: { repo: 'file:///tmp/src', domains: [{ host: 'example.com', port: 80 }] },
      },
    })
    expect(() => validate(cfg)).not.toThrow()
  })

  test('rejects invalid app name', () => {
    const cfg = base({
      apps: {
        Bad_Name: { repo: 'x/y', domains: [{ host: 'example.com', port: 80 }] },
      },
    })
    expect(() => validate(cfg)).toThrow(/name must match/)
  })
})
