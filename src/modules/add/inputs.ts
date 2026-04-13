import { MissingInputError } from '@jib/cli'
import {
  type App,
  type HealthCheck,
  type ParsedDomain,
  configParseDomain,
  configParseHealth,
  configToArray,
  configValidateRepo,
} from '@jib/config'
import { ValidationError } from '@jib/errors'
import {
  tuiIsInteractive,
  tuiPromptSelectResult,
  tuiPromptStringOptionalResult,
  tuiPromptStringResult,
} from '@jib/tui'
import { addMergeConfigEntries } from './config-entries.ts'
import { addParseEnvEntry, addSplitCommaValues } from './guided.ts'
import {
  addNormalizeRepo,
  addRepoPrompt,
  addResolvePersistPaths,
  addResolveRepoBackend,
} from './repo.ts'
import type { AddInputs, ConfigEntry, ConfigScope } from './types.ts'

interface GatherAddInputsDeps {
  isInteractive?: typeof tuiIsInteractive
  promptSelect?: typeof tuiPromptSelectResult
  promptString?: typeof tuiPromptStringResult
  promptStringOptional?: typeof tuiPromptStringOptionalResult
}

const APP_NAME_RE = /^[a-z0-9][a-z0-9-]*$/

/** Resolves and validates the target app name for `jib add`. */
export async function addResolveAppName(
  app: string | undefined,
  existingApps: Record<string, App>,
): Promise<string | MissingInputError | ValidationError | Error> {
  let value = app
  if (!value) {
    if (!tuiIsInteractive()) {
      return new MissingInputError('missing required input for jib add', [
        { field: 'app', message: 'provide <app> or rerun with interactive prompts enabled' },
      ])
    }
    const prompted = await tuiPromptStringResult({ message: 'App name', placeholder: 'my-app' })
    if (prompted instanceof Error) return prompted
    value = prompted
  }

  if (!APP_NAME_RE.test(value)) {
    return new ValidationError(`app name "${value}" must match ${APP_NAME_RE}`)
  }
  if (existingApps[value]) {
    return new ValidationError(`app "${value}" already exists in config`)
  }
  return value
}

/** Collects and validates the add-flow inputs from argv and optional prompts. */
export async function addGatherInputs(
  args: {
    repo?: string
    ingress?: string
    compose?: string
    domain?: string | string[]
    env?: string | string[]
    'build-arg'?: string | string[]
    'build-env'?: string | string[]
    health?: string | string[]
    persist?: string | string[]
    backend?: string
  },
  deps: GatherAddInputsDeps = {},
): Promise<AddInputs | MissingInputError | ValidationError | Error> {
  const interactive = deps.isInteractive ?? tuiIsInteractive
  const select = deps.promptSelect ?? tuiPromptSelectResult
  const prompt = deps.promptString ?? tuiPromptStringResult
  const promptOptional = deps.promptStringOptional ?? tuiPromptStringOptionalResult
  const backend = await addResolveRepoBackend(args.backend, args.repo, { interactive, select })
  if (backend instanceof Error) return backend
  let repo = args.repo
  if (!repo) {
    if (!interactive()) {
      return new MissingInputError('missing required input for jib add', [
        { field: 'repo', message: 'provide --repo or rerun with interactive prompts enabled' },
      ])
    }
    const prompted = await prompt(addRepoPrompt(backend))
    if (prompted instanceof Error) return prompted
    repo = prompted
  }
  repo = addNormalizeRepo(repo, backend)
  const repoErr = configValidateRepo(repo)
  if (repoErr) return new ValidationError(`--repo "${repo}" ${repoErr}`)
  const ingressDefault = args.ingress ?? 'direct'
  const composeRaw = args.compose ? addSplitCommaValues(args.compose) : undefined
  const persistPaths = await addResolvePersistPaths(repo, configToArray(args.persist), {
    interactive,
    promptOptional,
  })
  if (persistPaths instanceof Error) return persistPaths
  const parsedDomains = parseDomains(configToArray(args.domain), ingressDefault)
  if (parsedDomains instanceof Error) return parsedDomains
  const healthChecks = parseChecks(configToArray(args.health))
  if (healthChecks instanceof Error) return healthChecks
  const configEntries = parseConfigEntries(
    configToArray(args.env),
    configToArray(args['build-arg']),
    configToArray(args['build-env']),
  )
  if (configEntries instanceof Error) return configEntries
  return {
    repo,
    persistPaths,
    ingressDefault,
    ...(composeRaw ? { composeRaw } : {}),
    parsedDomains,
    configEntries,
    healthChecks,
  }
}

function parseDomains(
  rawDomains: string[],
  ingressDefault: string,
): ParsedDomain[] | ValidationError {
  const parsed: ParsedDomain[] = []
  for (const domain of rawDomains) {
    const result = configParseDomain(domain, ingressDefault)
    if (result instanceof Error) return new ValidationError(result.message)
    parsed.push(result)
  }
  return parsed
}

function parseChecks(rawHealth: string[]): HealthCheck[] | ValidationError {
  const parsed: HealthCheck[] = []
  for (const entry of rawHealth.flatMap((value) => value.split(','))) {
    const result = configParseHealth(entry)
    if (result instanceof Error) return new ValidationError(result.message)
    parsed.push(result)
  }
  return parsed
}

function parseConfigEntries(
  runtime: string[],
  build: string[],
  both: string[],
): ConfigEntry[] | ValidationError {
  const runtimeEntries = parseScopedEntries(runtime, 'runtime')
  if (runtimeEntries instanceof Error) return runtimeEntries
  const buildEntries = parseScopedEntries(build, 'build')
  if (buildEntries instanceof Error) return buildEntries
  const bothEntries = parseScopedEntries(both, 'both')
  if (bothEntries instanceof Error) return bothEntries
  try {
    return addMergeConfigEntries([...runtimeEntries, ...buildEntries, ...bothEntries])
  } catch (error) {
    return error instanceof ValidationError ? error : new ValidationError(String(error))
  }
}

function parseScopedEntries(
  rawEntries: string[],
  scope: ConfigScope,
): ConfigEntry[] | ValidationError {
  const entries: ConfigEntry[] = []
  for (const pair of rawEntries) {
    const entry = addParseEnvEntry(pair)
    if (entry instanceof Error) {
      return new ValidationError(`invalid ${flagForScope(scope)} "${pair}" - expected KEY=VALUE`)
    }
    entries.push({ ...entry, scope })
  }
  return entries
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
