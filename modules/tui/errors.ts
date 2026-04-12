import { ValidationError } from '@jib/errors'

export class TuiNotInteractiveError extends ValidationError {}

export class TuiPromptCancelledError extends ValidationError {
  constructor(message = 'cancelled', options?: ErrorOptions) {
    super(message, options)
  }
}

export class TuiPromptTooManyLinesError extends ValidationError {
  constructor(maxLines: number, options?: ErrorOptions) {
    super(`too many lines (max ${maxLines})`, options)
  }
}

export class TuiPemInvalidStartError extends ValidationError {
  constructor(options?: ErrorOptions) {
    super('PEM must start with -----BEGIN ...-----', options)
  }
}

export class TuiPemMissingBeginError extends ValidationError {
  constructor(options?: ErrorOptions) {
    super('invalid PEM: missing BEGIN marker', options)
  }
}

export class TuiPemMissingEndError extends ValidationError {
  constructor(options?: ErrorOptions) {
    super('invalid PEM: missing END marker', options)
  }
}

export function isTuiPemReadError(
  error: unknown,
): error is TuiPemInvalidStartError | TuiPemMissingBeginError | TuiPemMissingEndError {
  return (
    error instanceof TuiPemInvalidStartError ||
    error instanceof TuiPemMissingBeginError ||
    error instanceof TuiPemMissingEndError
  )
}
