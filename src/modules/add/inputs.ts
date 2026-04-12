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
import { dockerHubImage } from '@jib/paths'
import { isInteractive, promptSelect, promptString, promptStringOptional } from '@jib/tui'
import { GENERATED_COMPOSE_FILE } from './compose-scaffold.ts'
import { mergeConfigEntries } from './config-entries.ts'
import { parseEnvEntry, splitCommaValues } from './guided.ts'
import type { AddInputs, ConfigEntry, ConfigScope } from './types.ts'

type RepoBackend = 'github' | 'dockerhub' | 'other'

interface GatherAddInputsDeps {
  isInteractive?: typeof isInteractive
  promptSelect?: typeof promptSelect
  promptString?: typeof promptString
  promptStringOptional?: typeof promptStringOptional
}

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

export async function gatherAddInputs(
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
  const backend = await resolveRepoBackend(args.backend, args.repo, { interactive, select })
  let repo = args.repo
  if (!repo) {
    if (!interactive()) {
      throw new MissingInputError('missing required input for jib add', [
        { field: 'repo', message: 'provide --repo or rerun with interactive prompts enabled' },
      ])
    }
    repo = await prompt(repoPrompt(backend))
  }
  repo = normalizeRepo(repo, backend)
  const repoErr = validateRepo(repo)
  if (repoErr) throw new ValidationError(`--repo "${repo}" ${repoErr}`)
  const ingressDefault = args.ingress ?? 'direct'
  const composeRaw = args.compose ? splitCommaValues(args.compose) : undefined
  const persistPaths = await resolvePersistPaths(repo, toArray(args.persist), {
    interactive,
    promptOptional,
  })
  const parsedDomains = parseDomains(toArray(args.domain), ingressDefault)
  const healthChecks = parseChecks(toArray(args.health))
  const configEntries = parseConfigEntries(
    toArray(args.env),
    toArray(args['build-arg']),
    toArray(args['build-env']),
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

async function resolveRepoBackend(
  rawBackend: string | undefined,
  repo: string | undefined,
  deps: {
    interactive: () => boolean
    select: typeof promptSelect
  },
): Promise<RepoBackend | undefined> {
  if (rawBackend) return parseBackend(rawBackend)
  if (repo || !deps.interactive()) return undefined
  return (await deps.select({
    message: 'Source backend',
    options: [
      { value: 'github', label: 'GitHub', hint: 'owner/repo or GitHub URL' },
      { value: 'dockerhub', label: 'Docker Hub', hint: 'owner/repo or Docker Hub URL' },
      { value: 'other', label: 'Other/local', hint: 'absolute path or external git URL' },
    ],
  })) as RepoBackend
}

function parseBackend(rawBackend: string): RepoBackend {
  if (rawBackend === 'github' || rawBackend === 'dockerhub' || rawBackend === 'other') {
    return rawBackend
  }
  throw new ValidationError(`invalid --backend "${rawBackend}" (expected github|dockerhub|other)`)
}

function repoPrompt(backend: RepoBackend | undefined): { message: string; placeholder?: string } {
  switch (backend) {
    case 'github':
      return { message: 'GitHub repo (owner/name or URL)', placeholder: 'owner/repo' }
    case 'dockerhub':
      return { message: 'Docker Hub image (owner/name or URL)', placeholder: 'owner/image' }
    case 'other':
      return {
        message: 'Local path or external git URL',
        placeholder: '/srv/app or https://example.com/repo.git',
      }
    default:
      return {
        message: 'Source repo or Docker image URL',
        placeholder: 'owner/repo or https://…',
      }
  }
}

function normalizeRepo(repo: string, backend: RepoBackend | undefined): string {
  if (backend === 'github') return normalizeGitHubRepo(repo)
  if (backend !== 'dockerhub') return repo
  if (dockerHubImage(repo)) return repo
  return `docker://${repo}`
}

function normalizeGitHubRepo(repo: string): string {
  const https = normalizeGitHubHttpsRepo(repo)
  if (https) return https
  const ssh = repo.match(/^git@github\.com:([^\s]+?)(?:\.git)?$/)
  return ssh?.[1] ?? repo
}

function normalizeGitHubHttpsRepo(repo: string): string | null {
  if (!repo.startsWith('https://github.com/')) return null
  const { pathname } = new URL(repo)
  const parts = pathname.split('/').filter(Boolean)
  const owner = parts[0]
  const name = parts[1]?.replace(/\.git$/, '')
  return owner && name ? `${owner}/${name}` : null
}

async function resolvePersistPaths(
  repo: string,
  rawPersist: string[],
  deps: { interactive: () => boolean; promptOptional: typeof promptStringOptional },
): Promise<string[]> {
  if (rawPersist.length > 0) return rawPersist.flatMap(splitCommaValues)
  if (!dockerHubImage(repo) || !deps.interactive()) return []
  const raw = await deps.promptOptional({
    message: 'Persistent container path(s) (comma-separated, blank for none)',
    placeholder: '/data',
  })
  return splitCommaValues(raw)
}

export function buildDraftApp(args: { source?: string; branch?: string }, inputs: AddInputs): App {
  const image = dockerHubImage(inputs.repo)
  return parseApp({
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
