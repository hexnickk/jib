import { z } from 'zod'

export const CURRENT_SCHEMA_VERSION = 1

/** Persisted deploy state for a single application. Mirrors Go `AppState`. */
export const AppStateSchema = z.object({
  schema_version: z.number().int().default(CURRENT_SCHEMA_VERSION),
  app: z.string().default(''),
  strategy: z.string().default(''),
  deployed_sha: z.string().default(''),
  previous_sha: z.string().default(''),
  pinned: z.boolean().default(false),
  last_deploy: z.string().default(''),
  last_deploy_status: z.string().default(''),
  last_deploy_error: z.string().default(''),
  last_deploy_trigger: z.string().default(''),
  last_deploy_user: z.string().default(''),
  consecutive_failures: z.number().int().default(0),
})

export type AppState = z.infer<typeof AppStateSchema>

export function emptyState(app = ''): AppState {
  return AppStateSchema.parse({ app })
}
