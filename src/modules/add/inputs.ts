import { MissingInputError } from '@jib/cli'
import {
  type App,
  AppSchema,
  type Domain,
  type HealthCheck,
  type ParsedDomain,
  parseDomain,
  parseHealth,
  toArray,
  validateRepo,
} from '@jib/config'
import { ValidationError } from '@jib/errors'
import { isInteractive, promptString } from '@jib/tui'
import { mergeConfigEntries } from './config-entries.ts'
import { parseEnvEntry, splitCommaValues } from './guided.ts'
import type { AddInputs, ConfigEntry, ConfigScope } from './types.ts'

const APP_NAME_RE = /^[a-z0-9][a-z0-9-]*$/

export async function resolveAddAppName(
  app: string | undefined,
  existingApps: Record<string, App>,
): Promise<string> {
  let value = app
  if (!value) {
    if (!isInteractive()) {
      throw new MissingInputError('missing required input for jib add', [
        { field: 'app', message: 'provide <app> or rerun with interactive prompts enabled' },
      ])
    }
    value = await promptString({ message: 'App name', placeholder: 'my-app' })
  }

  if (!APP_NAME_RE.test(value)) {
    throw new ValidationError(`app name "${value}" must match ${APP_NAME_RE}`)
  }
  if (existingApps[value]) {
    throw new ValidationError(`app "${value}" already exists in config`)
  }
  return value
}

export async function gatherAddInputs(args: {
  repo?: string
  ingress?: string
  compose?: string
  domain?: string | string[]
  env?: string | string[]
  'build-arg'?: string | string[]
  'build-env'?: string | string[]
  health?: string | string[]
}): Promise<AddInputs> {
  let repo = args.repo
  if (!repo) {
    if (!isInteractive()) {
      throw new MissingInputError('missing required input for jib add', [
        { field: 'repo', message: 'provide --repo or rerun with interactive prompts enabled' },
      ])
    }
    repo = await promptString({
      message: 'Git repo (owner/name, "local", URL, or absolute path)',
    })
  }
  const repoErr = validateRepo(repo)
  if (repoErr) throw new ValidationError(`--repo "${repo}" ${repoErr}`)
  const ingressDefault = args.ingress ?? 'direct'
  const composeRaw = args.compose ? splitCommaValues(args.compose) : undefined
  const parsedDomains = parseDomains(toArray(args.domain), ingressDefault)
  const healthChecks = parseChecks(toArray(args.health))
  const configEntries = parseConfigEntries(
    toArray(args.env),
    toArray(args['build-arg']),
    toArray(args['build-env']),
  )
  return {
    repo,
    ingressDefault,
    ...(composeRaw ? { composeRaw } : {}),
    parsedDomains,
    configEntries,
    healthChecks,
  }
}

export function buildDraftApp(args: { source?: string; branch?: string }, inputs: AddInputs): App {
  return parseApp({
    repo: inputs.repo,
    branch: args.branch ?? 'main',
    domains: [],
    env_file: '.env',
    ...(args.source ? { source: args.source } : {}),
    ...(inputs.composeRaw ? { compose: inputs.composeRaw } : {}),
    ...(inputs.healthChecks.length > 0 ? { health: inputs.healthChecks } : {}),
  })
}

export function parseApp(appObj: Partial<App> & { repo: string; domains: Domain[] }): App {
  const parsed = AppSchema.safeParse(appObj)
  if (!parsed.success) {
    throw new ValidationError(`invalid app config: ${parsed.error.message}`)
  }
  return parsed.data
}

function parseDomains(rawDomains: string[], ingressDefault: string): ParsedDomain[] {
  try {
    return rawDomains.map((domain) => parseDomain(domain, ingressDefault))
  } catch (error) {
    throw new ValidationError(error instanceof Error ? error.message : String(error))
  }
}

function parseChecks(rawHealth: string[]): HealthCheck[] {
  try {
    return rawHealth.flatMap((h) => h.split(',')).map(parseHealth)
  } catch (error) {
    throw new ValidationError(error instanceof Error ? error.message : String(error))
  }
}

function parseConfigEntries(runtime: string[], build: string[], both: string[]): ConfigEntry[] {
  return mergeConfigEntries([
    ...parseScopedEntries(runtime, 'runtime'),
    ...parseScopedEntries(build, 'build'),
    ...parseScopedEntries(both, 'both'),
  ])
}

function parseScopedEntries(rawEntries: string[], scope: ConfigScope): ConfigEntry[] {
  return rawEntries.map((pair) => {
    try {
      return { ...parseEnvEntry(pair), scope }
    } catch {
      throw new ValidationError(`invalid ${flagForScope(scope)} "${pair}" - expected KEY=VALUE`)
    }
  })
}

function flagForScope(scope: ConfigScope): string {
  switch (scope) {
    case 'runtime':
      return '--env'
    case 'build':
      return '--build-arg'
    case 'both':
      return '--build-env'
  }
}
