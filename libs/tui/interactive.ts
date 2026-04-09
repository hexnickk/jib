import { ValidationError, assertCanPrompt, canPrompt, promptBlockReason } from '@jib/core'

/**
 * A jib process is considered interactive iff both std streams are TTYs and
 * the CLI runtime allows prompting and both std streams are TTYs.
 */
export function isInteractive(): boolean {
  return canPrompt()
}

/** Throws `ValidationError` if the process can't prompt the user. */
export function assertInteractive(): void {
  try {
    assertCanPrompt()
  } catch (error) {
    if (error instanceof ValidationError) {
      throw new ValidationError(promptBlockReason() ?? error.message, { cause: error })
    }
    throw error
  }
}
