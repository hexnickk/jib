import { cliCanPrompt, cliDescribePromptBlock } from '@jib/cli'
import { TuiNotInteractiveError } from './errors.ts'

/**
 * A jib process is considered interactive iff both std streams are TTYs and
 * the CLI runtime allows prompting.
 */
export function isInteractive(): boolean {
  return cliCanPrompt()
}

/** Returns the typed non-interactive error instead of throwing it. */
export function assertInteractiveResult(): TuiNotInteractiveError | undefined {
  const reason = cliDescribePromptBlock()
  return reason ? new TuiNotInteractiveError(reason) : undefined
}

/** Throws `TuiNotInteractiveError` if the process can't prompt the user. */
export function assertInteractive(): void {
  const error = assertInteractiveResult()
  if (error) throw error
}
