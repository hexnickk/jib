import { type Config, configLoad } from '@jib/config'
import { CancelledError, type JibError, ValidationError, errorsToJibError } from '@jib/errors'
import type { Paths } from '@jib/paths'
import { tuiIsInteractive, tuiPromptConfirmResult, tuiPromptSelectResult } from '@jib/tui'
import {
  sourcesAvailableSetupOptions,
  sourcesConfiguredOptions,
  sourcesRepoHasAuthFailure,
  sourcesRepoSupportsRecovery,
  sourcesRunSetup,
} from './recovery.ts'
import { sourcesProbe } from './service.ts'
import type { SourceSelectOption, SourceTarget } from './types.ts'

/** Builds choices from configured sources and source drivers that can be set up. */
export function sourcesBuildChoices(cfg: Config): SourceSelectOption[] {
  return [
    ...sourcesConfiguredOptions(cfg),
    ...sourcesAvailableSetupOptions().map((option) => ({
      value: `setup:${option.value}`,
      label: `Set up new ${option.label}`,
    })),
  ]
}

/** Owns driver selection and setup prompts; callers only provide application context. */
export async function sourcesSetupRef(ctx: {
  cfg: Config
  paths: Paths
}): Promise<string | JibError | null> {
  const options = sourcesAvailableSetupOptions()
  if (options.length === 0) {
    return null
  }
  const only = options.length === 1 ? options[0] : undefined
  if (only) {
    return sourcesRunSetup(ctx.cfg, ctx.paths, only.value)
  }
  if (!tuiIsInteractive()) {
    return new ValidationError(
      'missing source setup selection; rerun with interactive prompts enabled',
    )
  }
  const choice = await tuiPromptSelectResult({
    message: 'What kind of source would you like to set up?',
    options,
  })
  return choice instanceof Error ? choice : sourcesRunSetup(ctx.cfg, ctx.paths, choice)
}

/** Probes a chosen source and owns interactive recovery for authentication failures. */
export async function sourcesPreflightSelection(
  ctx: { cfg: Config; paths: Paths },
  selection: SourceTarget & { repo: string },
): Promise<{ cfg: Config; source?: string; branch: string } | JibError> {
  const { paths } = ctx
  let cfg = ctx.cfg
  let source = selection.source
  for (;;) {
    const probe = await sourcesProbe(cfg, paths, {
      app: selection.app,
      repo: selection.repo,
      ...(selection.branch ? { branch: selection.branch } : {}),
      ...(source ? { source } : {}),
    }).catch(errorsToJibError)
    if (!(probe instanceof Error)) {
      const branch = probe?.branch ?? selection.branch ?? 'main'
      return source ? { cfg, source, branch } : { cfg, branch }
    }
    const next = await recover({ cfg, paths }, { repo: selection.repo, source }, probe)
    if (next instanceof Error) {
      return next
    }
    if (!next) {
      return probe
    }
    source = next
    const reloaded = await configLoad(paths.configFile)
    if (reloaded instanceof Error) {
      return reloaded
    }
    cfg = reloaded
  }
}

async function recover(
  ctx: { cfg: Config; paths: Paths },
  selection: Pick<SourceTarget, 'source'> & { repo: string },
  error: JibError,
): Promise<string | JibError | null> {
  const { cfg, paths } = ctx
  const { repo, source } = selection
  if (
    !tuiIsInteractive() ||
    !sourcesRepoSupportsRecovery(repo) ||
    !sourcesRepoHasAuthFailure(repo, error)
  ) {
    return null
  }
  const choice = await tuiPromptSelectResult({
    message:
      'Repo access failed. Choose an existing source or set up a new one, then retry the clone.',
    options: sourcesBuildChoices(cfg),
    ...(source && cfg.sources[source] ? { initialValue: `existing:${source}` } : {}),
  })
  if (choice instanceof Error) {
    return choice
  }
  if (choice.startsWith('existing:')) {
    return choice.slice('existing:'.length)
  }
  const created = await sourcesRunSetup(cfg, paths, choice.slice('setup:'.length))
  if (!created) {
    return new CancelledError('source setup did not complete; add cancelled')
  }
  const confirmed = await tuiPromptConfirmResult({
    message: `After finishing setup for "${created}", retry the clone now?`,
    initialValue: true,
  })
  if (confirmed instanceof Error) {
    return confirmed
  }
  return confirmed ? created : new CancelledError('add cancelled')
}
