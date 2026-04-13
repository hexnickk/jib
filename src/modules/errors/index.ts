/**
 * Typed error base used across jib libs. Prefer specific subclasses and
 * `instanceof` checks over matching message text. `code` remains available as
 * machine-readable metadata when a caller needs it.
 */
export class JibError extends Error {
  readonly code: string

  constructor(code: string, message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = new.target.name
    this.code = code
  }
}

export class ValidationError extends JibError {
  constructor(message: string, options?: ErrorOptions) {
    super('validation', message, options)
  }
}
