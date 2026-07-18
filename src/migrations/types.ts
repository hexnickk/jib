import type { InitContext } from '@/flows/init/types.ts'
import { configLoad } from '@jib/config'
import { InternalError, type JibError } from '@jib/errors'
import { loggingCreateLogger } from '@jib/logging'
import type { Paths } from '@jib/paths'
import type { JibDb } from '@jib/state'

export interface MigrationContext {
  db: JibDb
  paths: Paths
}

/** A result-style schema/host migration executed by the migration runner. */
export interface JibMigration {
  id: string
  description: string
  up: (ctx: MigrationContext) => Promise<JibError | undefined>
}

/** Builds an init context from migration state or returns the config-load failure. */
export async function initCtx(mctx: MigrationContext): Promise<InitContext | JibError> {
  const config = await configLoad(mctx.paths.configFile)
  if (config instanceof Error) {
    return config
  }
  try {
    return { config, logger: loggingCreateLogger('init'), paths: mctx.paths }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return new InternalError(`create migration init context: ${message}`, { cause: error })
  }
}
