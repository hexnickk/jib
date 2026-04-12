import { JibError } from '@jib/errors'

export interface CliIssue {
  field: string
  message: string
}

export interface CliErrorOptions extends ErrorOptions {
  details?: unknown
  exitCode?: number
  hint?: string
  issues?: CliIssue[]
}

export interface NormalizedCliError {
  code: string
  message: string
  exitCode: number
  hint?: string
  issues?: CliIssue[]
  details?: unknown
}

export class CliError extends JibError {
  readonly details: unknown | undefined
  readonly exitCode: number
  readonly hint: string | undefined
  readonly issues: CliIssue[] | undefined

  constructor(code: string, message: string, options: CliErrorOptions = {}) {
    super(code, message, options)
    this.details = options.details
    this.exitCode = options.exitCode ?? 1
    this.hint = options.hint
    this.issues = options.issues
  }
}

export class MissingInputError extends CliError {
  constructor(message: string, issues: CliIssue[], options: Omit<CliErrorOptions, 'issues'> = {}) {
    super('missing_input', message, { ...options, issues })
  }
}

export class InvalidInteractiveModeError extends CliError {
  constructor(value: string) {
    super('invalid_interactive_mode', `invalid --interactive value "${value}"`, {
      hint: 'expected one of: auto, always, never',
    })
  }
}

export class InvalidOutputModeError extends CliError {
  constructor(value: string) {
    super('invalid_output_mode', `invalid --output value "${value}"`, {
      hint: 'expected one of: text, json',
    })
  }
}

/** Creates a typed error for commands that are missing required interactive input. */
export function cliCreateMissingInputError(message: string, issues: CliIssue[]): MissingInputError {
  return new MissingInputError(message, issues)
}

/** Normalizes thrown or returned failures into the CLI response shape. */
export function cliNormalizeError(error: unknown): NormalizedCliError {
  if (error instanceof CliError) {
    return {
      code: error.code,
      message: error.message,
      exitCode: error.exitCode,
      ...(error.hint !== undefined && { hint: error.hint }),
      ...(error.issues !== undefined && { issues: error.issues }),
      ...(error.details !== undefined && { details: error.details }),
    }
  }
  if (error instanceof JibError) {
    return { code: error.code, message: error.message, exitCode: 1 }
  }
  if (error instanceof Error) {
    return { code: 'internal', message: error.message, exitCode: 1 }
  }
  return { code: 'internal', message: String(error), exitCode: 1 }
}
