import { type CliRuntime, cliCanPrompt, cliDescribePromptBlock } from '@jib/cli'
import { ValidationError } from '@jib/errors'

/**
 * Returns whether the active or provided runtime allows prompts on TTY streams.
 * Supplying a runtime evaluates that explicit snapshot without reading process-global CLI state.
 */
export function tuiIsInteractive(runtime?: CliRuntime): boolean {
  if (!runtime) {
    return cliCanPrompt()
  }
  if (runtime.interactive === 'never') {
    return false
  }
  return runtime.stdinTty && runtime.stdoutTty
}

/** Returns a validation error when the active or provided runtime cannot accept prompts. */
export function tuiAssertInteractiveResult(runtime?: CliRuntime): ValidationError | undefined {
  const reason = runtime
    ? runtime.interactive === 'never'
      ? 'interactive prompts are disabled by --interactive=never'
      : !runtime.stdinTty || !runtime.stdoutTty
        ? 'interactive prompts require a TTY'
        : null
    : cliDescribePromptBlock()
  return reason ? new ValidationError(reason) : undefined
}
