import { describe, expect, test } from 'bun:test'
import { parseDomain, parseDomainResult, parseHealth, parseHealthResult } from './add-parse.ts'
import { ParseDomainArgError, ParseHealthArgError } from './errors.ts'

describe('add parse helpers', () => {
  test('parseDomain accepts the supported domain syntax', () => {
    expect(
      parseDomain('host=example.com,port=8080,service=web,ingress=cloudflare-tunnel', 'direct'),
    ).toEqual({
      host: 'example.com',
      container_port: 8080,
      service: 'web',
      ingress: 'cloudflare-tunnel',
    })
  })

  test('parseDomainResult returns a typed error on malformed input', () => {
    const parsed = parseDomainResult('host=example.com,port=not-a-number', 'direct')
    expect(parsed).toBeInstanceOf(ParseDomainArgError)
  })

  test('parseDomain still throws for compatibility', () => {
    expect(() => parseDomain('host=example.com,port=not-a-number', 'direct')).toThrow(
      ParseDomainArgError,
    )
  })

  test('parseHealth parses path and port and rejects malformed input', () => {
    expect(parseHealth('/health:8080')).toEqual({ path: '/health', port: 8080 })
    expect(parseHealthResult('health:8080')).toBeInstanceOf(ParseHealthArgError)
    expect(() => parseHealth('health:8080')).toThrow(ParseHealthArgError)
  })
})
