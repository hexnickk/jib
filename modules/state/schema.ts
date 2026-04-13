import { z } from 'zod'

export const CURRENT_SCHEMA_VERSION = 1

/**
 * Persisted deploy state for a single app. Trimmed to only the fields jib
 * actually reads: deployed SHA/workdir for the current deploy, plus a
 * debug-only last-deploy summary a human can `cat`. No rollback pointers
 * (rollback is deliberately absent — fix-forward only). No auto-pinning
 * counter (nothing gated on it).
 */
export const AppStateSchema = z.object({
  schema_version: z.number().int().default(CURRENT_SCHEMA_VERSION),
  app: z.string().default(''),
  deployed_sha: z.string().default(''),
  deployed_workdir: z.string().default(''),
  last_deploy: z.string().default(''),
  last_deploy_status: z.string().default(''),
  last_deploy_error: z.string().default(''),
})

export type AppState = z.infer<typeof AppStateSchema>

/** Builds the empty on-disk state shape for one app. */
export function stateEmpty(app = ''): AppState {
  return AppStateSchema.parse({ app })
}
