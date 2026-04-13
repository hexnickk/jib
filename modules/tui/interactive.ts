import { cliCanPrompt, cliDescribePromptBlock } from '@jib/cli'
import { TuiNotInteractiveError } from './errors.ts'

/**
 * A jib process is considered interactive iff both std streams are TTYs and
 * the CLI runtime allows prompting.
 */
export function tuiIsInteractive(): boolean {
  return cliCanPrompt()
}

/** Returns the typed non-interactive error instead of throwing it. */
export function tuiAssertInteractiveResult(): TuiNotInteractiveError | undefined {
  const reason = cliDescribePromptBlock()
  return reason ? new TuiNotInteractiveError(reason) : undefined
}
