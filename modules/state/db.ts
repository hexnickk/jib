import { Database } from 'bun:sqlite'
import { join } from 'node:path'
import { drizzle } from 'drizzle-orm/bun-sqlite'
import * as schema from './tables.ts'

const DB_FILE = 'jib.db'

/**
 * Open (or create) the jib SQLite database at `$JIB_ROOT/state/jib.db`.
 *
 * Schema is applied via CREATE TABLE IF NOT EXISTS instead of Drizzle's
 * file-based migrator because `bun build --compile` does not bundle the
 * generated SQL files. Drizzle is used as a query builder only.
 */
export function stateOpenDb(stateDir: string) {
  const dbPath = join(stateDir, DB_FILE)
  const sqlite = new Database(dbPath)
  sqlite.run('PRAGMA journal_mode = WAL')
  sqlite.run(`CREATE TABLE IF NOT EXISTS jib_migrations (
    id TEXT PRIMARY KEY NOT NULL,
    at TEXT NOT NULL DEFAULT (datetime('now'))
  )`)

  return drizzle(sqlite, { schema })
}

export type JibDb = ReturnType<typeof stateOpenDb>
