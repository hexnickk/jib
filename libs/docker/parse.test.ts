import { describe, expect, test } from 'bun:test'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  type ComposeService,
  hasPublishedPorts,
  inferContainerPort,
  inferHealthAndPort,
  parseComposeServices,
  parseFirstHostPort,
  parseHealthcheck,
} from './parse.ts'

function svc(partial: Partial<ComposeService>): ComposeService {
  return { name: 'x', hostPort: 0, ports: [], expose: [], ...partial }
}

function fixture(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), 'jib-docker-'))
  for (const [name, content] of Object.entries(files)) {
    writeFileSync(join(dir, name), content)
  }
  return dir
}

describe('parseFirstHostPort', () => {
  test('"3000:3000" -> 3000', () => expect(parseFirstHostPort('3000:3000')).toBe(3000))
  test('"8080:80/tcp" -> 8080', () => expect(parseFirstHostPort('8080:80/tcp')).toBe(8080))
  test('"127.0.0.1:5000:80" -> 5000', () =>
    expect(parseFirstHostPort('127.0.0.1:5000:80')).toBe(5000))
  test('3000 -> 3000', () => expect(parseFirstHostPort(3000)).toBe(3000))
  test('{published:8080} -> 8080', () => expect(parseFirstHostPort({ published: 8080 })).toBe(8080))
  test('garbage -> 0', () => expect(parseFirstHostPort(null)).toBe(0))
})

describe('parseHealthcheck', () => {
  test('CMD array with curl', () => {
    const got = parseHealthcheck(['CMD', 'curl', '-f', 'http://localhost:3000/health'])
    expect(got).toEqual({ path: '/health', port: 3000 })
  })
  test('CMD-SHELL string', () => {
    const got = parseHealthcheck('curl -f http://localhost:8080/status || exit 1')
    expect(got).toEqual({ path: '/status', port: 8080 })
  })
  test('non-http command returns undefined', () => {
    expect(parseHealthcheck(['CMD', 'pg_isready'])).toBeUndefined()
  })
})

describe('parseComposeServices', () => {
  test('minimal compose extracts service name', () => {
    const dir = fixture({
      'docker-compose.yml': 'services:\n  web:\n    image: nginx\n',
    })
    const svc = parseComposeServices(dir)
    expect(svc).toHaveLength(1)
    expect(svc[0]?.name).toBe('web')
    expect(svc[0]?.hostPort).toBe(0)
  })

  test('extracts ports, labels, and healthcheck', () => {
    const dir = fixture({
      'docker-compose.yml': `services:
  api:
    image: api
    ports: ["8080:80"]
    labels:
      jib.domain: api.example.com
      jib.ingress: cloudflare-tunnel
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:80/health"]
`,
    })
    const svc = parseComposeServices(dir)
    const api = svc[0]
    expect(api?.hostPort).toBe(8080)
    expect(api?.domain).toBe('api.example.com')
    expect(api?.ingress).toBe('cloudflare-tunnel')
    expect(api?.healthPath).toBe('/health')
    expect(api?.healthPort).toBe(80)
  })

  test('later file overrides earlier file field-by-field', () => {
    const dir = fixture({
      'base.yml': 'services:\n  web:\n    ports: ["3000:3000"]\n',
      'over.yml': 'services:\n  web:\n    ports: ["4000:3000"]\n',
    })
    const svc = parseComposeServices(dir, ['base.yml', 'over.yml'])
    expect(svc[0]?.hostPort).toBe(4000)
  })

  test('list-form labels are normalised', () => {
    const dir = fixture({
      'docker-compose.yml': `services:
  web:
    labels:
      - "jib.domain=foo.example.com"
`,
    })
    const svc = parseComposeServices(dir)
    expect(svc[0]?.domain).toBe('foo.example.com')
  })
})

describe('inferHealthAndPort', () => {
  test('prefers service with both health + host port', () => {
    const got = inferHealthAndPort([
      svc({ name: 'a', hostPort: 1000 }),
      svc({ name: 'b', hostPort: 2000, healthPath: '/ready', healthPort: 80 }),
    ])
    expect(got).toEqual({ path: '/ready', port: 2000 })
  })
  test('falls back to first host-mapped port with default /health', () => {
    const got = inferHealthAndPort([svc({ name: 'a', hostPort: 1234 })])
    expect(got).toEqual({ path: '/health', port: 1234 })
  })
  test('no ports -> port=0', () => {
    expect(inferHealthAndPort([])).toEqual({ path: '/health', port: 0 })
  })
})

describe('inferContainerPort / hasPublishedPorts', () => {
  test('ports: ["8080:80"] -> container 80, published=true', () => {
    const s = svc({ ports: ['8080:80'] })
    expect(inferContainerPort(s)).toBe(80)
    expect(hasPublishedPorts(s)).toBe(true)
  })
  test('ports: ["80"] (no host) -> container 80, published=true', () => {
    const s = svc({ ports: ['80'] })
    expect(inferContainerPort(s)).toBe(80)
    expect(hasPublishedPorts(s)).toBe(true)
  })
  test('expose: ["3000"] -> container 3000, published=false', () => {
    const s = svc({ expose: ['3000'] })
    expect(inferContainerPort(s)).toBe(3000)
    expect(hasPublishedPorts(s)).toBe(false)
  })
  test('both ports and expose -> ports wins', () => {
    const s = svc({ ports: ['8080:80'], expose: ['3000'] })
    expect(inferContainerPort(s)).toBe(80)
  })
  test('neither -> undefined, false', () => {
    const s = svc({})
    expect(inferContainerPort(s)).toBeUndefined()
    expect(hasPublishedPorts(s)).toBe(false)
  })
  test('long-form {target: 80} object', () => {
    const s = svc({ ports: [{ target: 80, published: 8080 }] })
    expect(inferContainerPort(s)).toBe(80)
  })
  test('127.0.0.1:8080:80 -> container 80', () => {
    const s = svc({ ports: ['127.0.0.1:8080:80'] })
    expect(inferContainerPort(s)).toBe(80)
  })
})
