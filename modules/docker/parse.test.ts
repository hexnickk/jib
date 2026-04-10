import { describe, expect, test } from 'bun:test'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  type ComposeService,
  hasPublishedPorts,
  inferContainerPort,
  parseComposeServices,
} from './parse.ts'

function svc(partial: Partial<ComposeService>): ComposeService {
  return { name: 'x', ports: [], expose: [], envRefs: [], ...partial }
}

function fixture(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), 'jib-docker-'))
  for (const [name, content] of Object.entries(files)) {
    writeFileSync(join(dir, name), content)
  }
  return dir
}

describe('parseComposeServices', () => {
  test('minimal compose extracts service name', () => {
    const dir = fixture({
      'docker-compose.yml': 'services:\n  web:\n    image: nginx\n',
    })
    const out = parseComposeServices(dir)
    expect(out).toHaveLength(1)
    expect(out[0]?.name).toBe('web')
    expect(out[0]?.ports).toEqual([])
    expect(out[0]?.expose).toEqual([])
    expect(out[0]?.envRefs).toEqual([])
  })

  test('extracts ports and expose', () => {
    const dir = fixture({
      'docker-compose.yml': `services:
  api:
    image: api
    ports: ["8080:80"]
    expose: ["9000"]
`,
    })
    const out = parseComposeServices(dir)
    expect(out[0]?.ports).toEqual(['8080:80'])
    expect(out[0]?.expose).toEqual(['9000'])
    expect(out[0]?.envRefs).toEqual([])
  })

  test('later file overrides earlier file field-by-field', () => {
    const dir = fixture({
      'base.yml': 'services:\n  web:\n    ports: ["3000:3000"]\n',
      'over.yml': 'services:\n  web:\n    ports: ["4000:3000"]\n',
    })
    const out = parseComposeServices(dir, ['base.yml', 'over.yml'])
    expect(out[0]?.ports).toEqual(['4000:3000'])
  })

  test('extracts referenced environment keys', () => {
    const dir = fixture({
      'docker-compose.yml': `services:
  api:
    environment:
      DATABASE_URL: \${DATABASE_URL}
      STATIC_VALUE: hello
      EMPTY_FROM_ENV:
      API_KEY: ""
`,
    })
    const out = parseComposeServices(dir)
    expect(out[0]?.envRefs).toEqual(['DATABASE_URL', 'EMPTY_FROM_ENV'])
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
