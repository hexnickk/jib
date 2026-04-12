import { CliError } from '@jib/cli'
import { type Config, ConfigError, configLoad } from '@jib/config'
import type { Paths } from '@jib/paths'
import {
  availableSourceSetupOptions,
  configuredSourceOptions,
  isSourceAuthFailure as isSourceAuthFailureForRepo,
  repoSupportsSourceRecovery,
  runSourceSetup,
} from './recovery.ts'
import { probeSource } from './service.ts'
import type { SourceProbe, SourceTarget } from './types.ts'

type SourceChoice = `existing:${string}` | `setup:${string}`

export interface SourceRecoveryDeps {
  isInteractive?: () => boolean
  loadConfig?: (configFile: string) => Promise<Config | ConfigError>
  probe?: typeof probeSource
  promptSelect?: (opts: {
    message: string
    options: { value: SourceChoice; label: string; hint?: string }[]
    initialValue?: SourceChoice
  }) => Promise<SourceChoice>
  promptConfirm?: (opts: { message: string; initialValue?: boolean }) => Promise<boolean>
  runSetup?: (cfg: Config, paths: Paths, value: string) => Promise<string | null>
}

export function isSourceAuthFailure(repo: string, error: unknown): boolean {
  return isSourceAuthFailureForRepo(repo, error)
}

export function buildSourceChoices(
  cfg: Config,
): { value: SourceChoice; label: string; hint?: string }[] {
  const existing = configuredSourceOptions(cfg) as {
    value: SourceChoice
    label: string
    hint?: string
  }[]
  const setup = availableSourceSetupOptions().map((option) => ({
    value: `setup:${option.value}` as const,
    label: `Set up new ${option.label}`,
  }))
  return [...existing, ...setup]
}

async function createSourceRef(
  choice: Extract<SourceChoice, `setup:${string}`>,
  cfg: Config,
  paths: Paths,
  deps: Pick<SourceRecoveryDeps, 'runSetup'>,
): Promise<string | null> {
  const setupValue = choice.slice('setup:'.length)
  return (deps.runSetup ?? runSourceSetup)(cfg, paths, setupValue)
}

export async function setupSourceRef(
  cfg: Config,
  paths: Paths,
  deps: Pick<SourceRecoveryDeps, 'promptSelect' | 'runSetup'> = {},
): Promise<string | null> {
  const setupOptions = availableSourceSetupOptions()
  if (setupOptions.length === 0) return null
  if (setupOptions.length === 1) {
    const setupOption = setupOptions[0]
    if (!setupOption) return null
    return await (deps.runSetup ?? runSourceSetup)(cfg, paths, setupOption.value)
  }

  if (!deps.promptSelect) {
    throw new CliError('missing_input', 'missing source setup selection', {
      issues: [{ field: 'source', message: 'rerun with interactive prompts enabled' }],
    })
  }

  const choice = await deps.promptSelect({
    message: 'What kind of source would you like to set up?',
    options: setupOptions.map((option) => ({
      value: `setup:${option.value}` as const,
      label: option.label,
    })),
  })
  if (choice.startsWith('setup:')) {
    return await createSourceRef(
      choice as Extract<SourceChoice, `setup:${string}`>,
      cfg,
      paths,
      deps,
    )
  }
  return null
}

export async function preflightSourceSelection(
  appName: string,
  cfg: Config,
  paths: Paths,
  repo: string,
  currentSource?: string,
  currentBranch?: string,
  deps: SourceRecoveryDeps = {},
): Promise<{ cfg: Config; source?: string; branch: string }> {
  let resolvedCfg = cfg
  let source = currentSource
  const runProbe = deps.probe ?? probeSource
  const target = (): SourceTarget => ({
    app: appName,
    repo,
    ...(currentBranch ? { branch: currentBranch } : {}),
    ...(source ? { source } : {}),
  })

  for (;;) {
    let probed: Awaited<ReturnType<typeof probeSource>> | unknown
    try {
      probed = await runProbe(resolvedCfg, paths, target())
    } catch (error) {
      probed = error
    }

    const probeResult = probed as SourceProbe | Error | null
    if (!(probeResult instanceof Error)) {
      const branch = probeResult?.branch ?? currentBranch ?? 'main'
      return source ? { cfg: resolvedCfg, source, branch } : { cfg: resolvedCfg, branch }
    }

    const nextSource = await maybeRecoverSource(resolvedCfg, paths, repo, probed, source, deps)
    if (!nextSource) throw probed
    source = nextSource
    const reloaded = await (deps.loadConfig ?? configLoad)(paths.configFile)
    if (reloaded instanceof ConfigError) throw reloaded
    resolvedCfg = reloaded
  }
}

export async function maybeRecoverSource(
  cfg: Config,
  paths: Paths,
  repo: string,
  error: unknown,
  currentSource?: string,
  deps: SourceRecoveryDeps = {},
): Promise<string | null> {
  const interactive = deps.isInteractive?.() ?? false
  if (!interactive || !repoSupportsSourceRecovery(repo) || !isSourceAuthFailure(repo, error)) {
    return null
  }
  if (!deps.promptSelect) return null
  const hasCurrentSource = currentSource ? cfg.sources[currentSource] !== undefined : false
  const choice = await deps.promptSelect({
    message:
      'Repo access failed. Choose an existing source or set up a new one, then retry the clone.',
    options: buildSourceChoices(cfg),
    ...(hasCurrentSource ? { initialValue: `existing:${currentSource}` as SourceChoice } : {}),
  })
  if (choice.startsWith('existing:')) {
    return choice.slice('existing:'.length)
  }
  if (!choice.startsWith('setup:')) {
    return null
  }
  const created = await createSourceRef(
    choice as Extract<SourceChoice, `setup:${string}`>,
    cfg,
    paths,
    deps,
  )
  if (!created) {
    throw new CliError('cancelled', 'source setup did not complete; add cancelled')
  }
  const confirmed = await (deps.promptConfirm ?? (async () => true))({
    message: `After finishing setup for "${created}", retry the clone now?`,
    initialValue: true,
  })
  if (!confirmed) throw new CliError('cancelled', 'add cancelled')
  return created
}
