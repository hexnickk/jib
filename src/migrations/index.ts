import { jibMigrations } from '@jib/state'
import type { JibMigration, MigrationContext } from './types.ts'

export { buildSudoersContent } from './helpers.ts'
export { migrations } from './registry.ts'

/** Run all pending migrations. Returns IDs of newly applied ones. */
export async function runJibMigrations(
  ctx: MigrationContext,
  list: JibMigration[],
): Promise<string[]> {
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
    await m.up(ctx)
    ctx.db.insert(jibMigrations).values({ id: m.id }).run()
    applied.push(m.id)
  }
  return applied
}
