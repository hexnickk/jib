import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdirSync, rmSync } from 'node:fs'
import { getPaths } from '@jib/core'
import { openDb } from '@jib/state'
import type { JibDb } from '@jib/state'
import { jibMigrations } from '@jib/state'
import { runJibMigrations } from './index.ts'
import type { JibMigration, MigrationContext } from './types.ts'

const TMP = '/tmp/jib-migration-test'

let db: JibDb
let ctx: MigrationContext

beforeEach(() => {
  rmSync(TMP, { recursive: true, force: true })
  mkdirSync(`${TMP}/state`, { recursive: true })
  db = openDb(`${TMP}/state`)
  ctx = { db, paths: getPaths(TMP), rawConfig: null }
})

afterEach(() => {
  rmSync(TMP, { recursive: true, force: true })
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
    // Run once
    await runJibMigrations(ctx, migs)
    log.length = 0

    // Add a third, re-run
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

  test('stops on failure and does not record failed migration', async () => {
    const log: string[] = []
    const migs = [
      migration('a', () => log.push('a')),
      migration('b', () => {
        throw new Error('boom')
      }),
      migration('c', () => log.push('c')),
    ]
    await expect(runJibMigrations(ctx, migs)).rejects.toThrow('boom')
    expect(log).toEqual(['a'])
    const rows = db.select().from(jibMigrations).all()
    expect(rows.map((r) => r.id)).toEqual(['a'])
  })
})
