import { InternalError, errorsToJibError } from '@jib/errors'
import type { JibError } from '@jib/errors'
import { stateListMigrations, stateRecordMigration } from '@jib/state'
import type { JibMigration, MigrationContext } from './types.ts'

export { buildSudoersContent } from './helpers.ts'
export { migrations } from './registry.ts'

/** Runs pending migrations and returns applied IDs or an error retaining the failing migration cause. */
export async function runJibMigrationsResult(
  ctx: MigrationContext,
  list: JibMigration[],
): Promise<string[] | InternalError> {
  let existing: Set<string>
  try {
    existing = new Set(stateListMigrations(ctx.db).map((row) => row.id))
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return new InternalError(`failed to list recorded migrations: ${message}`, { cause: error })
  }
  const applied: string[] = []

  for (const migration of list) {
    if (existing.has(migration.id)) {
      continue
    }

    let migrationError: JibError | undefined
    try {
      migrationError = await migration.up(ctx)
    } catch (error) {
      migrationError = errorsToJibError(error)
    }
    if (migrationError) {
      return new InternalError(`migration ${migration.id} failed: ${migrationError.message}`, {
        cause: migrationError,
      })
    }

    try {
      stateRecordMigration(ctx.db, migration.id)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return new InternalError(`failed to record migration ${migration.id}: ${message}`, {
        cause: error,
      })
    }
    applied.push(migration.id)
  }
  return applied
}

/** Runs pending migrations using the same result-style contract as the lower-level runner. */
export async function runJibMigrations(
  ctx: MigrationContext,
  list: JibMigration[],
): Promise<string[] | InternalError> {
  return await runJibMigrationsResult(ctx, list)
}
