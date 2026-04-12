import { type Config, configLoad } from '@jib/config'
import type { Paths } from '@jib/paths'
import { SourceSetupCancelledError, SourceSetupSelectionRequiredError } from './errors.ts'
import {
  sourcesAvailableSetupOptions,
  sourcesConfiguredOptions,
  sourcesRepoHasAuthFailure,
  sourcesRepoSupportsRecovery,
  sourcesRunSetup,
} from './recovery.ts'
import { sourcesProbe } from './service.ts'
import type { SourceProbe, SourceTarget } from './types.ts'

type SourceChoice = `existing:${string}` | `setup:${string}`

export interface SourceRecoveryDeps {
  isInteractive?: () => boolean
  loadConfig?: (configFile: string) => Promise<Config | Error>
  probe?: typeof sourcesProbe
  promptSelect?: (opts: {
    message: string
    options: { value: SourceChoice; label: string; hint?: string }[]
    initialValue?: SourceChoice
  }) => Promise<SourceChoice>
  promptConfirm?: (opts: { message: string; initialValue?: boolean }) => Promise<boolean>
  runSetup?: (cfg: Config, paths: Paths, value: string) => Promise<string | null>
}

export function sourcesIsAuthFailure(repo: string, error: unknown): boolean {
  return sourcesRepoHasAuthFailure(repo, error)
}

export function sourcesBuildChoices(
  cfg: Config,
): { value: SourceChoice; label: string; hint?: string }[] {
  const existing = sourcesConfiguredOptions(cfg) as {
    value: SourceChoice
    label: string
    hint?: string
  }[]
  const setup = sourcesAvailableSetupOptions().map((option) => ({
    value: `setup:${option.value}` as const,
    label: `Set up new ${option.label}`,
  }))
  return [...existing, ...setup]
}

/** Runs a concrete setup choice like `setup:github` and returns the created source name. */
async function sourcesCreateSetupRef(
  choice: Extract<SourceChoice, `setup:${string}`>,
  cfg: Config,
  paths: Paths,
  deps: Pick<SourceRecoveryDeps, 'runSetup'>,
): Promise<string | null> {
  const setupValue = choice.slice('setup:'.length)
  return (deps.runSetup ?? sourcesRunSetup)(cfg, paths, setupValue)
}

export async function sourcesSetupRef(
  cfg: Config,
  paths: Paths,
  deps: Pick<SourceRecoveryDeps, 'promptSelect' | 'runSetup'> = {},
): Promise<string | Error | null> {
  const setupOptions = sourcesAvailableSetupOptions()
  if (setupOptions.length === 0) return null
  if (setupOptions.length === 1) {
    const setupOption = setupOptions[0]
    if (!setupOption) return null
    return (deps.runSetup ?? sourcesRunSetup)(cfg, paths, setupOption.value)
  }
  if (!deps.promptSelect) return new SourceSetupSelectionRequiredError()

  const choice = await deps.promptSelect({
    message: 'What kind of source would you like to set up?',
    options: setupOptions.map((option) => ({
      value: `setup:${option.value}` as const,
      label: option.label,
    })),
  })
  return choice.startsWith('setup:')
    ? sourcesCreateSetupRef(choice as Extract<SourceChoice, `setup:${string}`>, cfg, paths, deps)
    : null
}

export async function sourcesPreflightSelection(
  appName: string,
  cfg: Config,
  paths: Paths,
  repo: string,
  currentSource?: string,
  currentBranch?: string,
  deps: SourceRecoveryDeps = {},
): Promise<{ cfg: Config; source?: string; branch: string } | Error> {
  let resolvedCfg = cfg
  let source = currentSource
  const runProbe = deps.probe ?? sourcesProbe

  for (;;) {
    const target: SourceTarget = {
      app: appName,
      repo,
      ...(currentBranch ? { branch: currentBranch } : {}),
      ...(source ? { source } : {}),
    }
    const probeResult = await readSourceProbe(runProbe, resolvedCfg, paths, target)

    if (!(probeResult instanceof Error)) {
      const branch = probeResult?.branch ?? currentBranch ?? 'main'
      return source ? { cfg: resolvedCfg, source, branch } : { cfg: resolvedCfg, branch }
    }

    const nextSource = await sourcesMaybeRecover(
      resolvedCfg,
      paths,
      repo,
      probeResult,
      source,
      deps,
    )
    if (nextSource instanceof Error) return nextSource
    if (!nextSource) return probeResult

    source = nextSource
    const reloaded = await (deps.loadConfig ?? configLoad)(paths.configFile)
    if (reloaded instanceof Error) return reloaded
    resolvedCfg = reloaded
  }
}

/**
 * Returns a replacement source when an auth-shaped probe failure can be fixed
 * interactively. `null` means the original probe error should be surfaced.
 */
export async function sourcesMaybeRecover(
  cfg: Config,
  paths: Paths,
  repo: string,
  error: unknown,
  currentSource?: string,
  deps: SourceRecoveryDeps = {},
): Promise<string | Error | null> {
  const interactive = deps.isInteractive?.() ?? false
  if (!interactive || !sourcesRepoSupportsRecovery(repo) || !sourcesIsAuthFailure(repo, error)) {
    return null
  }
  if (!deps.promptSelect) return null

  const hasCurrentSource = currentSource ? cfg.sources[currentSource] !== undefined : false
  const choice = await deps.promptSelect({
    message:
      'Repo access failed. Choose an existing source or set up a new one, then retry the clone.',
    options: sourcesBuildChoices(cfg),
    ...(hasCurrentSource ? { initialValue: `existing:${currentSource}` as SourceChoice } : {}),
  })

  if (choice.startsWith('existing:')) return choice.slice('existing:'.length)
  if (!choice.startsWith('setup:')) return null

  const created = await sourcesCreateSetupRef(
    choice as Extract<SourceChoice, `setup:${string}`>,
    cfg,
    paths,
    deps,
  )
  if (!created) {
    return new SourceSetupCancelledError('source setup did not complete; add cancelled')
  }

  const confirmed = await (deps.promptConfirm ?? (async () => true))({
    message: `After finishing setup for "${created}", retry the clone now?`,
    initialValue: true,
  })
  return confirmed ? created : new SourceSetupCancelledError('add cancelled')
}

/** Converts legacy throwing probe deps into the result-style contract used by sources flows. */
async function readSourceProbe(
  probe: typeof sourcesProbe,
  cfg: Config,
  paths: Paths,
  target: SourceTarget,
): Promise<SourceProbe | Error | null> {
  try {
    return await probe(cfg, paths, target)
  } catch (error) {
    return error instanceof Error ? error : new Error(String(error))
  }
}
