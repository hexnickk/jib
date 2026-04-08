import { Database } from 'bun:sqlite'
import { join } from 'node:path'
import { drizzle } from 'drizzle-orm/bun-sqlite'
import { migrate } from 'drizzle-orm/bun-sqlite/migrator'
import * as schema from './tables.ts'

const DB_FILE = 'jib.db'

/**
 * Open (or create) the jib SQLite database at `$JIB_ROOT/state/jib.db`.
 * Applies any pending Drizzle DB‑schema migrations on every call.
 */
export function openDb(stateDir: string) {
  const dbPath = join(stateDir, DB_FILE)
  const sqlite = new Database(dbPath)
  sqlite.run('PRAGMA journal_mode = WAL')

  const db = drizzle(sqlite, { schema })

  migrate(db, {
    migrationsFolder: join(import.meta.dir, 'drizzle'),
    migrationsTable: 'jib_db_migrations',
  })

  return db
}

export type JibDb = ReturnType<typeof openDb>
