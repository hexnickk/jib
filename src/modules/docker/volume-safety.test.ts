import { describe, expect, test } from 'bun:test'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { dockerFindUnsafeBindMounts } from './volume-safety.ts'

function fixture(compose: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'jib-volume-safety-'))
  writeFileSync(join(dir, 'docker-compose.yml'), compose)
  return dir
}

describe('dockerFindUnsafeBindMounts', () => {
  test('allows named volumes', () => {
    const dir = fixture(
      'services:\n  app:\n    volumes:\n      - sqlite:/data\nvolumes:\n  sqlite: {}\n',
    )
    expect(dockerFindUnsafeBindMounts(dir)).toEqual([])
  })

  test('rejects short absolute bind mounts', () => {
    const dir = fixture('services:\n  app:\n    volumes:\n      - /data/sqlite:/data/sqlite\n')
    expect(dockerFindUnsafeBindMounts(dir)).toEqual([{ service: 'app', source: '/data/sqlite' }])
  })

  test('rejects relative bind mounts', () => {
    const dir = fixture('services:\n  app:\n    volumes:\n      - ./data:/data\n')
    expect(dockerFindUnsafeBindMounts(dir)).toEqual([{ service: 'app', source: './data' }])
  })

  test('rejects long-form bind mounts', () => {
    const dir = fixture(
      'services:\n  app:\n    volumes:\n      - type: bind\n        source: /srv/data\n        target: /data\n',
    )
    expect(dockerFindUnsafeBindMounts(dir)).toEqual([{ service: 'app', source: '/srv/data' }])
  })
})
