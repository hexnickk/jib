import { type Config, configLoad } from '@jib/config'
import { CancelledError, type JibError, ValidationError, errorsToJibError } from '@jib/errors'
import type { Paths } from '@jib/paths'
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
  loadConfig?: (configFile: string) => Promise<Config | JibError>
  probe?: typeof sourcesProbe
  promptSelect?: (opts: {
    message: string
    options: { value: SourceChoice; label: string; hint?: string }[]
    initialValue?: SourceChoice
  }) => Promise<SourceChoice | JibError>
  promptConfirm?: (opts: { message: string; initialValue?: boolean }) => Promise<boolean | JibError>
  runSetup?: (cfg: Config, paths: Paths, value: string) => Promise<string | null>
}

/** Checks whether an error represents an authentication failure for the selected repository. */
export function sourcesIsAuthFailure(repo: string, error: unknown): boolean {
  return sourcesRepoHasAuthFailure(repo, error)
}

/** Builds choices from configured sources and source drivers that can be set up. */
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

/** Prompts for a source driver setup when more than one setup option exists. */
export async function sourcesSetupRef(
  cfg: Config,
  paths: Paths,
  deps: Pick<SourceRecoveryDeps, 'promptSelect' | 'runSetup'> = {},
): Promise<string | JibError | null> {
  const setupOptions = sourcesAvailableSetupOptions()
  if (setupOptions.length === 0) {
    return null
  }
  if (setupOptions.length === 1) {
    const setupOption = setupOptions[0]
    if (!setupOption) {
      return null
    }
    return await (deps.runSetup ?? sourcesRunSetup)(cfg, paths, setupOption.value)
  }
  if (!deps.promptSelect) {
    return new ValidationError(
      'missing source setup selection; rerun with interactive prompts enabled',
    )
  }

  const choice = await deps.promptSelect({
    message: 'What kind of source would you like to set up?',
    options: setupOptions.map((option) => ({
      value: `setup:${option.value}` as const,
      label: option.label,
    })),
  })
  if (choice instanceof Error) {
    return choice
  }
  if (!choice.startsWith('setup:')) {
    return null
  }
  return (deps.runSetup ?? sourcesRunSetup)(cfg, paths, choice.slice('setup:'.length))
}

/** Probes a chosen source and offers interactive recovery for authentication failures. */
export async function sourcesPreflightSelection(
  ctx: { cfg: Config; paths: Paths },
  selection: SourceTarget & { repo: string },
  deps: SourceRecoveryDeps = {},
): Promise<{ cfg: Config; source?: string; branch: string } | JibError> {
  const { cfg, paths } = ctx
  const { app: appName, repo, source: currentSource, branch: currentBranch } = selection
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
    let probeResult: SourceProbe | JibError | null
    try {
      probeResult = await runProbe(resolvedCfg, paths, target)
    } catch (error) {
      probeResult = errorsToJibError(error)
    }
    if (!(probeResult instanceof Error)) {
      const branch = probeResult?.branch ?? currentBranch ?? 'main'
      return source ? { cfg: resolvedCfg, source, branch } : { cfg: resolvedCfg, branch }
    }

    const nextSource = await sourcesMaybeRecover(
      { cfg: resolvedCfg, paths },
      { repo, source },
      probeResult,
      deps,
    )
    if (nextSource instanceof Error) {
      return nextSource
    }
    if (!nextSource) {
      return probeResult
    }

    source = nextSource
    const reloaded = await (deps.loadConfig ?? configLoad)(paths.configFile)
    if (reloaded instanceof Error) {
      return reloaded
    }
    resolvedCfg = reloaded
  }
}

/** Attempts interactive source recovery and returns a replacement source or no recovery. */
export async function sourcesMaybeRecover(
  ctx: { cfg: Config; paths: Paths },
  selection: Pick<SourceTarget, 'source'> & { repo: string },
  error: unknown,
  deps: SourceRecoveryDeps = {},
): Promise<string | JibError | null> {
  const { cfg, paths } = ctx
  const { repo, source: currentSource } = selection
  const interactive = deps.isInteractive?.() ?? false
  if (!interactive || !sourcesRepoSupportsRecovery(repo) || !sourcesIsAuthFailure(repo, error)) {
    return null
  }
  if (!deps.promptSelect) {
    return null
  }

  const hasCurrentSource = currentSource ? cfg.sources[currentSource] !== undefined : false
  const choice = await deps.promptSelect({
    message:
      'Repo access failed. Choose an existing source or set up a new one, then retry the clone.',
    options: sourcesBuildChoices(cfg),
    ...(hasCurrentSource ? { initialValue: `existing:${currentSource}` as SourceChoice } : {}),
  })
  if (choice instanceof Error) {
    return choice
  }
  if (choice.startsWith('existing:')) {
    return choice.slice('existing:'.length)
  }
  if (!choice.startsWith('setup:')) {
    return null
  }

  const created = await (deps.runSetup ?? sourcesRunSetup)(
    cfg,
    paths,
    choice.slice('setup:'.length),
  )
  if (!created) {
    return new CancelledError('source setup did not complete; add cancelled')
  }

  const confirmed = await (deps.promptConfirm ?? (async () => true))({
    message: `After finishing setup for "${created}", retry the clone now?`,
    initialValue: true,
  })
  if (confirmed instanceof Error) {
    return confirmed
  }
  return confirmed ? created : new CancelledError('add cancelled')
}
