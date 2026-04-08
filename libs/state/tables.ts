import { sql } from 'drizzle-orm'
import { sqliteTable, text } from 'drizzle-orm/sqlite-core'

/** Tracks which jib system migrations have been applied. */
export const jibMigrations = sqliteTable('jib_migrations', {
  id: text('id').primaryKey(),
  at: text('at').notNull().default(sql`(datetime('now'))`),
})
