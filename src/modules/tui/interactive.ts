import { type CliRuntime, cliCanPrompt, cliDescribePromptBlock } from '@jib/cli'
import { TuiNotInteractiveError } from './errors.ts'

/**
 * Returns whether the active or provided runtime allows prompts on TTY streams.
 * Supplying a runtime evaluates that explicit snapshot without reading process-global CLI state.
 */
export function tuiIsInteractive(runtime?: CliRuntime): boolean {
  if (!runtime) return cliCanPrompt()
  if (runtime.interactive === 'never') return false
  return runtime.stdinTty && runtime.stdoutTty
}

/** Returns a typed non-interactive error for the active or provided runtime instead of throwing. */
export function tuiAssertInteractiveResult(
  runtime?: CliRuntime,
): TuiNotInteractiveError | undefined {
  const reason = runtime
    ? runtime.interactive === 'never'
      ? 'interactive prompts are disabled by --interactive=never'
      : !runtime.stdinTty || !runtime.stdoutTty
        ? 'interactive prompts require a TTY'
        : null
    : cliDescribePromptBlock()
  return reason ? new TuiNotInteractiveError(reason) : undefined
}
