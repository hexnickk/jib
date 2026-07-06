import { join } from 'node:path'
import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import * as schema from './tables.ts'
import { jibMigrations } from './tables.ts'

const DB_FILE = 'jib.db'

/**
 * Open (or create) the jib SQLite database at `$JIB_ROOT/state/jib.db`.
 *
 * Schema is applied via CREATE TABLE IF NOT EXISTS so bundled npm installs do
 * not need external migration SQL files. Drizzle remains the query builder.
 */
export function stateOpenDb(stateDir: string) {
  const dbPath = join(stateDir, DB_FILE)
  const sqlite = new Database(dbPath)
  sqlite.pragma('journal_mode = WAL')
  sqlite.exec(`CREATE TABLE IF NOT EXISTS jib_migrations (
    id TEXT PRIMARY KEY NOT NULL,
    at TEXT NOT NULL DEFAULT (datetime('now'))
  )`)

  return drizzle(sqlite, { schema })
}

export type JibDb = ReturnType<typeof stateOpenDb>

/** Reads migration rows through Drizzle for tests and migration orchestration. */
export function stateListMigrations(db: JibDb) {
  return db.select().from(jibMigrations).all()
}

/** Records a migration id through Drizzle. Side effect inserts one row. */
export function stateRecordMigration(db: JibDb, id: string): void {
  db.insert(jibMigrations).values({ id }).run()
}
