import { setupDeployKey, setupGitHubApp } from '@jib-module/github'
import type { Config, GitHubProvider } from '@jib/config'
import {
  CliError,
  type ModuleContext,
  type Paths,
  createLogger,
  isExternalRepoURL,
} from '@jib/core'
import { isInteractive, promptConfirm, promptSelect } from '@jib/tui'

type ProviderChoice = `existing:${string}` | 'setup:key' | 'setup:app'

export interface GitHubProviderRecoveryDeps {
  isInteractive?: () => boolean
  promptSelect?: (opts: {
    message: string
    options: { value: ProviderChoice; label: string; hint?: string }[]
    initialValue?: ProviderChoice
  }) => Promise<ProviderChoice>
  promptConfirm?: (opts: { message: string; initialValue?: boolean }) => Promise<boolean>
  setupDeployKey?: (ctx: ModuleContext<Config>) => Promise<string | null>
  setupGitHubApp?: (ctx: ModuleContext<Config>) => Promise<string | null>
}

export function isGitHubSlugRepo(repo: string): boolean {
  return repo !== 'local' && !isExternalRepoURL(repo)
}

export function isGitHubAuthFailure(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error)
  return [
    'Permission denied (publickey)',
    'Could not read from remote repository',
    'Authentication failed',
    'Repository not found',
    'could not read Username',
  ].some((snippet) => message.includes(snippet))
}

function providerHint(provider: GitHubProvider): string {
  return provider.type === 'app' ? 'GitHub App' : 'deployment key'
}

export function buildGitHubProviderChoices(
  cfg: Config,
): { value: ProviderChoice; label: string; hint?: string }[] {
  const existing = Object.entries(cfg.github?.providers ?? {}).map(([name, provider]) => ({
    value: `existing:${name}` as const,
    label: name,
    hint: providerHint(provider),
  }))
  return [
    ...existing,
    { value: 'setup:key', label: 'Set up new GitHub deployment key' },
    { value: 'setup:app', label: 'Set up new GitHub app' },
  ]
}

export async function maybeRecoverGitHubProvider(
  cfg: Config,
  paths: Paths,
  repo: string,
  error: unknown,
  currentProvider?: string,
  deps: GitHubProviderRecoveryDeps = {},
): Promise<string | null> {
  const interactive = deps.isInteractive ?? isInteractive
  if (!interactive() || !isGitHubSlugRepo(repo) || !isGitHubAuthFailure(error)) return null

  const choice = await (deps.promptSelect ?? promptSelect<ProviderChoice>)({
    message: 'GitHub repo access failed. If this repo is private, choose a provider to retry.',
    options: buildGitHubProviderChoices(cfg),
    ...(currentProvider ? { initialValue: `existing:${currentProvider}` as ProviderChoice } : {}),
  })

  if (choice.startsWith('existing:')) {
    return choice.slice('existing:'.length)
  }

  const ctx: ModuleContext<Config> = { config: cfg, logger: createLogger('github'), paths }
  const created =
    choice === 'setup:key'
      ? await (deps.setupDeployKey ?? setupDeployKey)(ctx)
      : await (deps.setupGitHubApp ?? setupGitHubApp)(ctx)

  if (!created) {
    throw new CliError('cancelled', 'git provider setup did not complete; add cancelled')
  }

  const confirmed = await (deps.promptConfirm ?? promptConfirm)({
    message: `After finishing GitHub-side setup for "${created}", retry the clone now?`,
    initialValue: true,
  })
  if (!confirmed) throw new CliError('cancelled', 'add cancelled')
  return created
}
