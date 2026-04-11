import { loadConfig } from '@jib/config'
import { createLogger } from '@jib/logging'
import type { Paths } from '@jib/paths'
import type { JibDb } from '@jib/state'
import type { InitContext } from '../modules/init/types.ts'

export interface MigrationContext {
  db: JibDb
  paths: Paths
}

export interface JibMigration {
  id: string
  description: string
  up: (ctx: MigrationContext) => Promise<void>
}

/** Build an init context from a MigrationContext. Safe from migration 0003+. */
export async function initCtx(mctx: MigrationContext): Promise<InitContext> {
  const config = await loadConfig(mctx.paths.configFile)
  return { config, logger: createLogger('init'), paths: mctx.paths }
}
