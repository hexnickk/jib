import { jibMigrations } from '@jib/state'
import { RunMigrationError, errorMessage } from './errors.ts'
import type { JibMigration, MigrationContext } from './types.ts'

export { MigrationError, RunMigrationError, RunPendingMigrationsError } from './errors.ts'
export { buildSudoersContent } from './helpers.ts'
export { migrations } from './registry.ts'

/** Run all pending migrations. Returns IDs of newly applied ones. */
export async function runJibMigrationsResult(
  ctx: MigrationContext,
  list: JibMigration[],
): Promise<string[] | RunMigrationError> {
  const existing = new Set(
    ctx.db
      .select({ id: jibMigrations.id })
      .from(jibMigrations)
      .all()
      .map((r) => r.id),
  )

  const applied: string[] = []
  for (const m of list) {
    if (existing.has(m.id)) continue

    try {
      await m.up(ctx)
    } catch (error) {
      return new RunMigrationError(`migration ${m.id} failed: ${errorMessage(error)}`, {
        cause: error instanceof Error ? error : undefined,
      })
    }

    try {
      ctx.db.insert(jibMigrations).values({ id: m.id }).run()
    } catch (error) {
      return new RunMigrationError(`failed to record migration ${m.id}: ${errorMessage(error)}`, {
        cause: error instanceof Error ? error : undefined,
      })
    }

    applied.push(m.id)
  }
  return applied
}

export async function runJibMigrations(
  ctx: MigrationContext,
  list: JibMigration[],
): Promise<string[]> {
  const result = await runJibMigrationsResult(ctx, list)
  if (result instanceof Error) throw result
  return result
}
