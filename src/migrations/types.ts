import type { Config } from '@jib/config'
import { loadConfig } from '@jib/config'
import type { ModuleContext, Paths } from '@jib/core'
import { createLogger } from '@jib/core'
import type { JibDb } from '@jib/state'

export interface MigrationContext {
  db: JibDb
  paths: Paths
  rawConfig: Record<string, unknown> | null
}

export interface JibMigration {
  id: string
  description: string
  up: (ctx: MigrationContext) => Promise<void>
}

/** Build a ModuleContext from a MigrationContext. Safe from migration 0003+. */
export async function moduleCtx(mctx: MigrationContext): Promise<ModuleContext<Config>> {
  const config = await loadConfig(mctx.paths.configFile)
  return { config, logger: createLogger('init'), paths: mctx.paths }
}
