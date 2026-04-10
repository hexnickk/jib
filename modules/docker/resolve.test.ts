import { describe, expect, test } from 'bun:test'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { App } from '@jib/config'
import { inspectComposeApp, resolveFromCompose } from './resolve.ts'

function fixture(yaml: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'jib-resolve-'))
  writeFileSync(join(dir, 'docker-compose.yml'), yaml)
  return dir
}

function mkApp(overrides: Partial<App>): App {
  return {
    repo: 'local',
    branch: 'main',
    domains: [],
    env_file: '.env',
    ...overrides,
  } as App
}

describe('resolveFromCompose', () => {
  test('single-service compose auto-fills service + container_port from ports', () => {
    const dir = fixture('services:\n  web:\n    image: nginx\n    ports: ["8080:80"]\n')
    const app = mkApp({ domains: [{ host: 'demo.example.com', port: 20000 }] })
    const out = resolveFromCompose(app, dir)
    expect(out.domains[0]?.service).toBe('web')
    expect(out.domains[0]?.container_port).toBe(80)
  })

  test('single-service compose with expose infers container_port', () => {
    const dir = fixture('services:\n  api:\n    image: api\n    expose: ["3000"]\n')
    const app = mkApp({ domains: [{ host: 'demo.example.com', port: 20000 }] })
    const out = resolveFromCompose(app, dir)
    expect(out.domains[0]?.service).toBe('api')
    expect(out.domains[0]?.container_port).toBe(3000)
  })

  test('user-provided container_port wins over inferred', () => {
    const dir = fixture('services:\n  web:\n    image: nginx\n    ports: ["8080:80"]\n')
    const app = mkApp({
      domains: [{ host: 'demo.example.com', port: 20000, container_port: 1234 }],
    })
    const out = resolveFromCompose(app, dir)
    expect(out.domains[0]?.container_port).toBe(1234)
  })

  test('multi-service compose without =service throws with service list', () => {
    const dir = fixture(
      'services:\n  web:\n    image: nginx\n  api:\n    image: api\n    ports: ["3000:3000"]\n',
    )
    const app = mkApp({ domains: [{ host: 'demo.example.com', port: 20000 }] })
    expect(() => resolveFromCompose(app, dir)).toThrow(/multiple services.*web.*api/)
  })

  test('multi-service compose with =service routes correctly', () => {
    const dir = fixture(
      'services:\n  web:\n    image: nginx\n    expose: ["80"]\n  api:\n    image: api\n    expose: ["3000"]\n',
    )
    const app = mkApp({
      domains: [
        { host: 'a.example.com', port: 20000, service: 'web' },
        { host: 'b.example.com', port: 20001, service: 'api' },
      ],
    })
    const out = resolveFromCompose(app, dir)
    expect(out.domains[0]?.container_port).toBe(80)
    expect(out.domains[1]?.container_port).toBe(3000)
  })

  test('unknown service name throws', () => {
    const dir = fixture('services:\n  web:\n    image: nginx\n')
    const app = mkApp({
      domains: [{ host: 'demo.example.com', port: 20000, service: 'ghost' }],
    })
    expect(() => resolveFromCompose(app, dir)).toThrow(/no service "ghost"/)
  })

  test('worker-only app with no domains only validates compose', () => {
    const dir = fixture('services:\n  worker:\n    image: busybox\n')
    const app = mkApp({})
    const out = resolveFromCompose(app, dir)
    expect(out).toEqual(app)
  })

  test('multi-service compose without domains is valid', () => {
    const dir = fixture('services:\n  web:\n    image: nginx\n  worker:\n    image: busybox\n')
    const app = mkApp({})
    const out = resolveFromCompose(app, dir)
    expect(out).toEqual(app)
  })

  test('missing compose file produces a clean error', () => {
    const dir = mkdtempSync(join(tmpdir(), 'jib-resolve-'))
    const app = mkApp({ domains: [{ host: 'demo.example.com', port: 20000 }] })
    expect(() => resolveFromCompose(app, dir)).toThrow(/no compose file found/)
  })

  test('no container_port inferable falls back to 80', () => {
    const dir = fixture('services:\n  web:\n    image: nginx\n')
    const app = mkApp({ domains: [{ host: 'demo.example.com', port: 20000 }] })
    const out = resolveFromCompose(app, dir)
    expect(out.domains[0]?.container_port).toBe(80)
  })

  test('inspectComposeApp discovers compose.yml when compose is omitted', () => {
    const dir = mkdtempSync(join(tmpdir(), 'jib-resolve-'))
    writeFileSync(join(dir, 'compose.yml'), 'services:\n  web:\n    image: nginx\n')

    const inspection = inspectComposeApp({ compose: undefined }, dir)

    expect(inspection.composeFiles).toEqual(['compose.yml'])
    expect(inspection.services.map((service) => service.name)).toEqual(['web'])
  })

  test('inspectComposeApp reports an explicit missing compose path clearly', () => {
    const dir = mkdtempSync(join(tmpdir(), 'jib-resolve-'))

    expect(() => inspectComposeApp({ compose: ['docker-compose.yml'] }, dir)).toThrow(
      /compose file not found: docker-compose.yml/,
    )
  })
})
