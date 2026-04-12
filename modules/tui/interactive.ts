import { canPrompt, promptBlockReason } from '@jib/cli'
import { TuiNotInteractiveError } from './errors.ts'

/**
 * A jib process is considered interactive iff both std streams are TTYs and
 * the CLI runtime allows prompting.
 */
export function isInteractive(): boolean {
  return canPrompt()
}

export function assertInteractiveResult(): TuiNotInteractiveError | undefined {
  const reason = promptBlockReason()
  return reason ? new TuiNotInteractiveError(reason) : undefined
}

/** Throws `TuiNotInteractiveError` if the process can't prompt the user. */
export function assertInteractive(): void {
  const error = assertInteractiveResult()
  if (error) throw error
}
