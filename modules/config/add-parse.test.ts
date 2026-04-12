import { describe, expect, test } from 'bun:test'
import { configParseDomain, configParseHealth } from './add-parse.ts'
import { ParseDomainArgError, ParseHealthArgError } from './errors.ts'

describe('add parse helpers', () => {
  test('parseDomain accepts the supported domain syntax', () => {
    expect(
      configParseDomain(
        'host=example.com,port=8080,service=web,ingress=cloudflare-tunnel',
        'direct',
      ),
    ).toEqual({
      host: 'example.com',
      container_port: 8080,
      service: 'web',
      ingress: 'cloudflare-tunnel',
    })
  })

  test('configParseDomain returns a typed error on malformed input', () => {
    const parsed = configParseDomain('host=example.com,port=not-a-number', 'direct')
    expect(parsed).toBeInstanceOf(ParseDomainArgError)
  })

  test('configParseHealth parses path and port and rejects malformed input', () => {
    expect(configParseHealth('/health:8080')).toEqual({ path: '/health', port: 8080 })
    expect(configParseHealth('health:8080')).toBeInstanceOf(ParseHealthArgError)
  })
})
