import { setupDeployKey, setupGitHubApp } from '@jib-module/github'
import type { Config, Source } from '@jib/config'
import {
  CliError,
  type ModuleContext,
  type Paths,
  createLogger,
  isExternalRepoURL,
} from '@jib/core'
import { isInteractive, promptConfirm, promptSelect } from '@jib/tui'

type SourceChoice = `existing:${string}` | 'setup:key' | 'setup:app'

export interface SourceRecoveryDeps {
  isInteractive?: () => boolean
  promptSelect?: (opts: {
    message: string
    options: { value: SourceChoice; label: string; hint?: string }[]
    initialValue?: SourceChoice
  }) => Promise<SourceChoice>
  promptConfirm?: (opts: { message: string; initialValue?: boolean }) => Promise<boolean>
  setupDeployKey?: (ctx: ModuleContext<Config>) => Promise<string | null>
  setupGitHubApp?: (ctx: ModuleContext<Config>) => Promise<string | null>
}

function sourceHint(source: Source): string {
  if (source.driver !== 'github') return source.driver
  return source.type === 'app' ? 'GitHub App' : 'GitHub deployment key'
}

function createSourceContext(cfg: Config, paths: Paths): ModuleContext<Config> {
  return { config: cfg, logger: createLogger('sources'), paths }
}

export function isGitHubSlugRepo(repo: string): boolean {
  return repo !== 'local' && !isExternalRepoURL(repo)
}

export function isSourceAuthFailure(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error)
  return [
    'Permission denied (publickey)',
    'Could not read from remote repository',
    'Authentication failed',
    'Repository not found',
    'could not read Username',
    'not found in config',
  ].some((snippet) => message.includes(snippet))
}

export function buildSourceChoices(
  cfg: Config,
): { value: SourceChoice; label: string; hint?: string }[] {
  const existing = Object.entries(cfg.sources).map(([name, source]) => ({
    value: `existing:${name}` as const,
    label: name,
    hint: sourceHint(source),
  }))
  return [
    ...existing,
    { value: 'setup:key', label: 'Set up new GitHub deploy key' },
    { value: 'setup:app', label: 'Set up new GitHub app' },
  ]
}

async function createSourceRef(
  choice: Extract<SourceChoice, 'setup:key' | 'setup:app'>,
  cfg: Config,
  paths: Paths,
  deps: Pick<SourceRecoveryDeps, 'setupDeployKey' | 'setupGitHubApp'>,
): Promise<string | null> {
  const ctx = createSourceContext(cfg, paths)
  return choice === 'setup:key'
    ? await (deps.setupDeployKey ?? setupDeployKey)(ctx)
    : await (deps.setupGitHubApp ?? setupGitHubApp)(ctx)
}

export async function setupSourceRef(
  cfg: Config,
  paths: Paths,
  deps: Pick<SourceRecoveryDeps, 'promptSelect' | 'setupDeployKey' | 'setupGitHubApp'> = {},
): Promise<string | null> {
  const choice = await (deps.promptSelect ?? promptSelect<SourceChoice>)({
    message: 'What kind of source would you like to set up?',
    options: [
      { value: 'setup:key', label: 'GitHub deploy key' },
      { value: 'setup:app', label: 'GitHub app' },
    ],
  })
  if (choice === 'setup:key' || choice === 'setup:app') {
    return await createSourceRef(choice, cfg, paths, deps)
  }
  return null
}

export async function maybeRecoverSource(
  cfg: Config,
  paths: Paths,
  repo: string,
  error: unknown,
  currentSource?: string,
  deps: SourceRecoveryDeps = {},
): Promise<string | null> {
  const interactive = deps.isInteractive ?? isInteractive
  if (!interactive() || !isGitHubSlugRepo(repo) || !isSourceAuthFailure(error)) return null
  const hasCurrentSource = currentSource ? cfg.sources[currentSource] !== undefined : false
  const choice = await (deps.promptSelect ?? promptSelect<SourceChoice>)({
    message:
      'Repo access failed. Choose an existing source or set up a new one, then retry the clone.',
    options: buildSourceChoices(cfg),
    ...(hasCurrentSource ? { initialValue: `existing:${currentSource}` as SourceChoice } : {}),
  })
  if (choice.startsWith('existing:')) {
    return choice.slice('existing:'.length)
  }
  if (choice !== 'setup:key' && choice !== 'setup:app') {
    return null
  }
  const created = await createSourceRef(choice, cfg, paths, deps)
  if (!created) {
    throw new CliError('cancelled', 'source setup did not complete; add cancelled')
  }
  const confirmed = await (deps.promptConfirm ?? promptConfirm)({
    message: `After finishing setup for "${created}", retry the clone now?`,
    initialValue: true,
  })
  if (!confirmed) throw new CliError('cancelled', 'add cancelled')
  return created
}
