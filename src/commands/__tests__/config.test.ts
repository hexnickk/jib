import { describe, expect, test } from 'bun:test'
import { getNested, isSecretKey, redact, setNested } from '../config.ts'

describe('getNested', () => {
  test('resolves dotted path', () => {
    expect(getNested({ a: { b: { c: 42 } } }, 'a.b.c')).toBe(42)
  })
  test('throws on missing', () => {
    expect(() => getNested({ a: {} }, 'a.b.c')).toThrow(/not found/)
  })
  test('throws when intermediate is scalar', () => {
    expect(() => getNested({ a: 1 }, 'a.b')).toThrow(/not a map/)
  })
})

describe('setNested', () => {
  test('creates intermediate maps', () => {
    const root: Record<string, unknown> = {}
    setNested(root, 'a.b.c', 'hi')
    expect(root).toEqual({ a: { b: { c: 'hi' } } })
  })
  test('overwrites existing scalar leaf', () => {
    const root: Record<string, unknown> = { a: { b: 1 } }
    setNested(root, 'a.b', 2)
    expect(root).toEqual({ a: { b: 2 } })
  })
  test('throws when intermediate is scalar', () => {
    expect(() => setNested({ a: 1 }, 'a.b', 2)).toThrow(/not a map/)
  })
})

describe('isSecretKey', () => {
  test('direct secret names', () => {
    for (const k of ['token', 'secret', 'password', 'private_key', 'key', 'pem']) {
      expect(isSecretKey(k)).toBe(true)
    }
  })
  test('substring match', () => {
    expect(isSecretKey('api_token')).toBe(true)
    expect(isSecretKey('jwt_secret')).toBe(true)
  })
  test('non-secret', () => {
    expect(isSecretKey('host')).toBe(false)
    expect(isSecretKey('port')).toBe(false)
    expect(isSecretKey('app_id')).toBe(false)
  })
})

describe('redact', () => {
  test('redacts leaf secret keys', () => {
    const input = {
      repo: 'foo/bar',
      token: 'abc',
      providers: { gh: { app_id: 1, pem: '-----BEGIN----' } },
    }
    const out = redact(input) as Record<string, unknown>
    expect(out.repo).toBe('foo/bar')
    expect(out.token).toBe('***REDACTED***')
    const providers = out.providers as Record<string, Record<string, unknown>>
    expect(providers.gh?.app_id).toBe(1)
    expect(providers.gh?.pem).toBe('***REDACTED***')
  })
  test('handles arrays', () => {
    const out = redact([{ token: 't' }, { name: 'ok' }]) as Array<Record<string, unknown>>
    expect(out[0]?.token).toBe('***REDACTED***')
    expect(out[1]?.name).toBe('ok')
  })
})
