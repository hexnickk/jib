import { describe, expect, test } from 'bun:test'
import type { Domain } from '@jib/config'
import { buildOverrideServices } from './engine.ts'

const parsed = (...names: string[]) => names.map((name) => ({ name }))

describe('buildOverrideServices', () => {
  test('single-service compose: domain port maps to that service', () => {
    const domains: Domain[] = [{ host: 'demo.example.com', port: 20000, container_port: 80 }]
    const out = buildOverrideServices(parsed('web'), domains)
    expect(out).toEqual([{ name: 'web', ports: [{ host: 20000, container: 80 }] }])
  })

  test('multi-service multi-domain groups ports per service', () => {
    const domains: Domain[] = [
      { host: 'a.example.com', port: 20000, container_port: 80, service: 'web' },
      { host: 'b.example.com', port: 20001, container_port: 3000, service: 'api' },
      { host: 'c.example.com', port: 20002, container_port: 443, service: 'web' },
    ]
    const out = buildOverrideServices(parsed('web', 'api'), domains)
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

  test('services with no matching domain still get an entry (no ports)', () => {
    const domains: Domain[] = [
      { host: 'a.example.com', port: 20000, container_port: 80, service: 'web' },
    ]
    const out = buildOverrideServices(parsed('web', 'worker'), domains)
    expect(out).toEqual([
      { name: 'web', ports: [{ host: 20000, container: 80 }] },
      { name: 'worker' },
    ])
  })

  test('domain without container_port is silently dropped (not a deployer concern)', () => {
    const domains: Domain[] = [{ host: 'a.example.com', port: 20000 }]
    const out = buildOverrideServices(parsed('web'), domains)
    expect(out).toEqual([{ name: 'web' }])
  })

  test('no domains: every service still listed without ports', () => {
    const out = buildOverrideServices(parsed('web', 'api'), [])
    expect(out).toEqual([{ name: 'web' }, { name: 'api' }])
  })
})
