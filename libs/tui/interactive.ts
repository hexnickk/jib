import { ValidationError } from '@jib/core'

/**
 * A jib process is considered interactive iff both std streams are TTYs and
 * `JIB_NON_INTERACTIVE` is unset. Automated callers should set the env var to
 * force the non-interactive code paths.
 */
export function isInteractive(): boolean {
  if (process.env.JIB_NON_INTERACTIVE) return false
  return Boolean(process.stdin.isTTY && process.stdout.isTTY)
}

/** Throws `ValidationError` if the process can't prompt the user. */
export function assertInteractive(): void {
  if (!isInteractive()) {
    throw new ValidationError('non-interactive mode: cannot prompt for input')
  }
}
