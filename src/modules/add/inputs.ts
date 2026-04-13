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
import { isInteractive, promptSelect, promptString, promptStringOptional } from '@jib/tui'
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
  isInteractive?: typeof isInteractive
  promptSelect?: typeof promptSelect
  promptString?: typeof promptString
  promptStringOptional?: typeof promptStringOptional
}

const APP_NAME_RE = /^[a-z0-9][a-z0-9-]*$/

/** Resolves and validates the target app name for `jib add`. */
export async function addResolveAppName(
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
): Promise<AddInputs> {
  const interactive = deps.isInteractive ?? isInteractive
  const select = deps.promptSelect ?? promptSelect
  const prompt = deps.promptString ?? promptString
  const promptOptional = deps.promptStringOptional ?? promptStringOptional
  const backend = await addResolveRepoBackend(args.backend, args.repo, { interactive, select })
  let repo = args.repo
  if (!repo) {
    if (!interactive()) {
      throw new MissingInputError('missing required input for jib add', [
        { field: 'repo', message: 'provide --repo or rerun with interactive prompts enabled' },
      ])
    }
    repo = await prompt(addRepoPrompt(backend))
  }
  repo = addNormalizeRepo(repo, backend)
  const repoErr = configValidateRepo(repo)
  if (repoErr) throw new ValidationError(`--repo "${repo}" ${repoErr}`)
  const ingressDefault = args.ingress ?? 'direct'
  const composeRaw = args.compose ? addSplitCommaValues(args.compose) : undefined
  const persistPaths = await addResolvePersistPaths(repo, configToArray(args.persist), {
    interactive,
    promptOptional,
  })
  const parsedDomains = parseDomains(configToArray(args.domain), ingressDefault)
  const healthChecks = parseChecks(configToArray(args.health))
  const configEntries = parseConfigEntries(
    configToArray(args.env),
    configToArray(args['build-arg']),
    configToArray(args['build-env']),
  )
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

function parseDomains(rawDomains: string[], ingressDefault: string): ParsedDomain[] {
  const parsed: ParsedDomain[] = []
  for (const domain of rawDomains) {
    const result = configParseDomain(domain, ingressDefault)
    if (result instanceof Error) throw new ValidationError(result.message)
    parsed.push(result)
  }
  return parsed
}

function parseChecks(rawHealth: string[]): HealthCheck[] {
  const parsed: HealthCheck[] = []
  for (const entry of rawHealth.flatMap((value) => value.split(','))) {
    const result = configParseHealth(entry)
    if (result instanceof Error) throw new ValidationError(result.message)
    parsed.push(result)
  }
  return parsed
}

function parseConfigEntries(runtime: string[], build: string[], both: string[]): ConfigEntry[] {
  return addMergeConfigEntries([
    ...parseScopedEntries(runtime, 'runtime'),
    ...parseScopedEntries(build, 'build'),
    ...parseScopedEntries(both, 'both'),
  ])
}

function parseScopedEntries(rawEntries: string[], scope: ConfigScope): ConfigEntry[] {
  return rawEntries.map((pair) => {
    try {
      return { ...addParseEnvEntry(pair), scope }
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
