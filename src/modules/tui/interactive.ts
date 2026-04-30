import {
  type CliRuntime,
  cliCanPrompt,
  cliDescribePromptBlock,
  cliRuntimeCanPrompt,
  cliRuntimeDescribePromptBlock,
} from '@jib/cli'
import { TuiNotInteractiveError } from './errors.ts'

/**
 * Returns whether the active or provided runtime allows prompts on TTY streams.
 * Supplying a runtime evaluates that explicit snapshot without reading process-global CLI state.
 */
export function tuiIsInteractive(runtime?: CliRuntime): boolean {
  return runtime ? cliRuntimeCanPrompt(runtime) : cliCanPrompt()
}

/** Returns a typed non-interactive error for the active or provided runtime instead of throwing. */
export function tuiAssertInteractiveResult(
  runtime?: CliRuntime,
): TuiNotInteractiveError | undefined {
  const reason = runtime ? cliRuntimeDescribePromptBlock(runtime) : cliDescribePromptBlock()
  return reason ? new TuiNotInteractiveError(reason) : undefined
}
