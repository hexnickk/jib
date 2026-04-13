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

/** Throws `TuiNotInteractiveError` if the process can't prompt the user. */
export function tuiAssertInteractive(): void {
  const error = tuiAssertInteractiveResult()
  if (error) throw error
}

export { tuiAssertInteractive as assertInteractive }
export { tuiAssertInteractiveResult as assertInteractiveResult }
export { tuiIsInteractive as isInteractive }
