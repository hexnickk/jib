import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathsGetPaths } from '@jib/paths'
import { stateOpenDb } from '@jib/state'
import type { JibDb } from '@jib/state'
import { jibMigrations } from '@jib/state'
import { RunMigrationError } from './errors.ts'
import { runJibMigrations, runJibMigrationsResult } from './index.ts'
import type { JibMigration, MigrationContext } from './types.ts'

let db: JibDb
let ctx: MigrationContext
let root = ''

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'jib-migration-test-'))
  const paths = pathsGetPaths(root)
  await mkdir(paths.stateDir, { recursive: true })
  db = stateOpenDb(paths.stateDir)
  ctx = { db, paths }
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

function migration(id: string, fn: () => void): JibMigration {
  return { id, description: `test ${id}`, up: async () => fn() }
}

describe('runJibMigrations', () => {
  test('runs all migrations on empty DB', async () => {
    const log: string[] = []
    const migs = [
      migration('a', () => log.push('a')),
      migration('b', () => log.push('b')),
      migration('c', () => log.push('c')),
    ]
    const applied = await runJibMigrations(ctx, migs)
    expect(applied).toEqual(['a', 'b', 'c'])
    expect(log).toEqual(['a', 'b', 'c'])
  })

  test('skips already-applied migrations', async () => {
    const log: string[] = []
    const migs = [migration('a', () => log.push('a')), migration('b', () => log.push('b'))]
    await runJibMigrations(ctx, migs)
    log.length = 0

    migs.push(migration('c', () => log.push('c')))
    const applied = await runJibMigrations(ctx, migs)
    expect(applied).toEqual(['c'])
    expect(log).toEqual(['c'])
  })

  test('returns empty array when nothing to do', async () => {
    const migs = [migration('a', () => {})]
    await runJibMigrations(ctx, migs)
    const applied = await runJibMigrations(ctx, migs)
    expect(applied).toEqual([])
  })

  test('records migration IDs in jib_migrations table', async () => {
    await runJibMigrations(ctx, [migration('x', () => {}), migration('y', () => {})])
    const rows = db.select().from(jibMigrations).all()
    expect(rows.map((r) => r.id).sort()).toEqual(['x', 'y'])
    for (const r of rows) expect(r.at).toBeTruthy()
  })

  test('returns typed failure and does not record failed migration', async () => {
    const log: string[] = []
    const migs = [
      migration('a', () => log.push('a')),
      migration('b', () => {
        throw new Error('boom')
      }),
      migration('c', () => log.push('c')),
    ]
    const result = await runJibMigrationsResult(ctx, migs)
    expect(result).toBeInstanceOf(RunMigrationError)
    if (!(result instanceof RunMigrationError)) throw new Error('expected RunMigrationError')
    expect(result.message).toContain('migration b failed')
    expect(result.message).toContain('boom')
    expect(log).toEqual(['a'])
    const rows = db.select().from(jibMigrations).all()
    expect(rows.map((r) => r.id)).toEqual(['a'])
  })

  test('compatibility wrapper still throws typed failure', async () => {
    const result = runJibMigrations(ctx, [
      migration('broken', () => {
        throw new Error('boom')
      }),
    ])
    await expect(result).rejects.toBeInstanceOf(RunMigrationError)
  })
})
