import { describe, expect, test } from 'bun:test'
import { ValidateConfigError } from './errors.ts'
import { ConfigSchema } from './schema.ts'
import { parseDuration, validate, validateConfig, validateRepo } from './validate.ts'

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
  test('accepts canonical repo inputs', () => {
    for (const repo of [
      '',
      'local',
      'hexnickk/jib',
      'docker://n8nio/n8n',
      'dockerhub://n8nio/n8n:latest',
      'https://hub.docker.com/r/n8nio/n8n',
      'file:///tmp/foo',
      'https://example.com/foo.git',
      'git@github.com:owner/name.git',
      '/srv/repos/app',
    ]) {
      expect(validateRepo(repo)).toBeNull()
    }
  })

  test('rejects traversal and malformed repo inputs', () => {
    for (const repo of [
      '../../etc',
      'owner/..',
      'a/b/c',
      'docker://bad ref',
      'https://hub.docker.com/not-a-repo-page',
      'not a repo',
    ]) {
      expect(validateRepo(repo)).not.toBeNull()
    }
  })
})

describe('validate', () => {
  test('validateConfig accepts valid config', () => {
    expect(validateConfig(base())).toBeUndefined()
  })

  test('validateConfig returns typed errors for invalid configs', () => {
    expect(validateConfig(base({ poll_interval: 'forever' }))).toBeInstanceOf(ValidateConfigError)
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
    const error = validateConfig(cfg)
    expect(error).toBeInstanceOf(ValidateConfigError)
    expect(error?.message).toContain('tunnel')
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
    expect(validateConfig(cfg)).toBeUndefined()
  })

  test('accepts app with matching source', () => {
    const cfg = base({
      sources: { prod: { driver: 'github', type: 'key' } },
      apps: {
        web: {
          repo: 'hexnickk/web',
          source: 'prod',
          domains: [{ host: 'example.com', port: 80 }],
        },
      },
    })
    expect(validateConfig(cfg)).toBeUndefined()
  })

  test('validate still throws for compatibility', () => {
    expect(() => validate(base({ poll_interval: 'forever' }))).toThrow(ValidateConfigError)
  })

  test('rejects repo with ".." traversal', () => {
    const cfg = base({
      apps: {
        web: { repo: '../../etc/passwd', domains: [{ host: 'example.com', port: 80 }] },
      },
    })
    expect(validateConfig(cfg)?.message).toContain('repo')
  })

  test('rejects invalid app name', () => {
    const cfg = base({
      apps: {
        Bad_Name: { repo: 'x/y', domains: [{ host: 'example.com', port: 80 }] },
      },
    })
    expect(validateConfig(cfg)?.message).toContain('name must match')
  })

  test('rejects image-backed app when repo is not local', () => {
    const cfg = base({
      apps: {
        web: {
          repo: 'owner/web',
          image: 'n8nio/n8n',
          domains: [{ host: 'example.com', port: 80 }],
        },
      },
    })
    expect(validateConfig(cfg)?.message).toContain('repo "local"')
  })
})
