/**
 * Typed error hierarchy used across jib libs. Every error carries a stable
 * `code` string so callers can switch on machine-readable identifiers instead
 * of matching on message text.
 */
export class JibError extends Error {
  readonly code: string

  constructor(code: string, message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'JibError'
    this.code = code
  }
}

export class ConfigError extends JibError {
  constructor(message: string, options?: ErrorOptions) {
    super('config', message, options)
    this.name = 'ConfigError'
  }
}

export class StateError extends JibError {
  constructor(message: string, options?: ErrorOptions) {
    super('state', message, options)
    this.name = 'StateError'
  }
}

export class LockError extends JibError {
  constructor(message: string, options?: ErrorOptions) {
    super('lock', message, options)
    this.name = 'LockError'
  }
}

export class ValidationError extends JibError {
  constructor(message: string, options?: ErrorOptions) {
    super('validation', message, options)
    this.name = 'ValidationError'
  }
}
