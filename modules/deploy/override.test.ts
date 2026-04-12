import { describe, expect, test } from 'bun:test'
import type { Domain } from '@jib/config'
import { deployBuildOverrideServices } from './override.ts'

const parsed = (...names: string[]) => names.map((name) => ({ name }))

describe('deployBuildOverrideServices', () => {
  test('single-service compose: domain port maps to that service', () => {
    const domains: Domain[] = [{ host: 'demo.example.com', port: 20000, container_port: 80 }]
    const out = deployBuildOverrideServices(parsed('web'), domains)
    expect(out).toEqual([{ name: 'web', ports: [{ host: 20000, container: 80 }] }])
  })

  test('multi-service multi-domain groups ports per service', () => {
    const domains: Domain[] = [
      { host: 'a.example.com', port: 20000, container_port: 80, service: 'web' },
      { host: 'b.example.com', port: 20001, container_port: 3000, service: 'api' },
      { host: 'c.example.com', port: 20002, container_port: 443, service: 'web' },
    ]
    const out = deployBuildOverrideServices(parsed('web', 'api'), domains)
    expect(out).toEqual([
      {
        name: 'web',
        ports: [
          { host: 20000, container: 80 },
          { host: 20002, container: 443 },
        ],
      },
      { name: 'api', ports: [{ host: 20001, container: 3000 }] },
    ])
  })

  test('services without a matching domain are omitted (user compose wins)', () => {
    // Services with no jib-allocated port inherit restart/logging from the
    // user's compose file. Forcing `restart: unless-stopped` on one-shot
    // services (migrations) would trap them in a loop.
    const domains: Domain[] = [
      { host: 'a.example.com', port: 20000, container_port: 80, service: 'web' },
    ]
    const out = deployBuildOverrideServices(parsed('web', 'worker'), domains)
    expect(out).toEqual([{ name: 'web', ports: [{ host: 20000, container: 80 }] }])
  })

  test('domain without container_port is silently dropped → service absent', () => {
    const domains: Domain[] = [{ host: 'a.example.com', port: 20000 }]
    const out = deployBuildOverrideServices(parsed('web'), domains)
    expect(out).toEqual([])
  })

  test('no domains: override is empty (user compose untouched)', () => {
    const out = deployBuildOverrideServices(parsed('web', 'api'), [])
    expect(out).toEqual([])
  })
})
