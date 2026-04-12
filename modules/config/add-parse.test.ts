import { describe, expect, test } from 'bun:test'
import { parseDomain, parseHealth } from './add-parse.ts'
import { ConfigError } from './errors.ts'

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

  test('parseDomain throws ConfigError on malformed input', () => {
    expect(() => parseDomain('host=example.com,port=not-a-number', 'direct')).toThrow(ConfigError)
  })

  test('parseHealth parses path and port and rejects malformed input', () => {
    expect(parseHealth('/health:8080')).toEqual({ path: '/health', port: 8080 })
    expect(() => parseHealth('health:8080')).toThrow(ConfigError)
  })
})
