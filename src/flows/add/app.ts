import { type App, AppSchema, type Domain, type HealthCheck } from '@jib/config'
import { ValidationError } from '@jib/errors'
import { pathsDockerHubImage } from '@jib/paths'
import { GENERATED_COMPOSE_FILE } from './compose-scaffold.ts'
import type { AddInputs } from './types.ts'

/** Builds the initial draft app config before compose inspection fills in details. */
export function addBuildDraftApp(
  args: { source?: string; branch?: string },
  inputs: AddInputs,
): App | ValidationError {
  const image = pathsDockerHubImage(inputs.repo)
  return addParseApp({
    repo: image ? 'local' : inputs.repo,
    ...(image ? { image } : {}),
    branch: args.branch ?? 'main',
    domains: [],
    env_file: '.env',
    ...(!inputs.composeRaw && image ? { compose: [GENERATED_COMPOSE_FILE] } : {}),
    ...(args.source ? { source: args.source } : {}),
    ...(inputs.composeRaw ? { compose: inputs.composeRaw } : {}),
    ...(inputs.healthChecks.length > 0 ? { health: inputs.healthChecks } : {}),
  })
}

/** Parses and validates a complete app config object for add flows. */
export function addParseApp(
  appObj: Partial<App> & { repo: string; domains: Domain[]; health?: HealthCheck[] },
): App | ValidationError {
  const parsed = AppSchema.safeParse(appObj)
  if (!parsed.success) {
    return new ValidationError(`invalid app config: ${parsed.error.message}`)
  }
  return parsed.data
}
