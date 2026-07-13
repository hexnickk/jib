/**
 * Base class for expected application failures. Its code is stable metadata
 * for command output; callers should recover by shared error type, not text.
 */
export class JibError extends Error {
  readonly code: string

  constructor(code: string, message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = new.target.name
    this.code = code
  }
}

/** Represents an expected operational failure and preserves its original cause. */
export class InternalError extends JibError {
  constructor(message: string, options?: ErrorOptions) {
    super('internal', message, options)
  }
}

/** Represents an expected absence that callers can handle differently from a failed operation. */
export class NotFoundError extends JibError {
  constructor(message: string, options?: ErrorOptions) {
    super('not_found', message, options)
  }
}

/** Represents invalid caller-provided input that can be corrected and retried. */
export class ValidationError extends JibError {
  constructor(message: string, options?: ErrorOptions) {
    super('validation', message, options)
  }
}

/** Represents a user-initiated cancellation that should not be reported as an operational failure. */
export class CancelledError extends JibError {
  constructor(message: string, options?: ErrorOptions) {
    super('cancelled', message, options)
  }
}
