import { JibError } from '@jib/errors'

export interface CliIssue {
  field: string
  message: string
}

export interface CliErrorOptions extends ErrorOptions {
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
}

export class CliError extends JibError {
  readonly exitCode: number
  readonly hint: string | undefined
  readonly issues: CliIssue[] | undefined

  constructor(code: string, message: string, options: CliErrorOptions = {}) {
    super(code, message, options)
    this.exitCode = options.exitCode ?? 1
    this.hint = options.hint
    this.issues = options.issues
  }
}

/** Creates a CLI response error for commands that are missing required interactive input. */
export function cliCreateMissingInputError(message: string, issues: CliIssue[]): CliError {
  return new CliError('missing_input', message, { issues })
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
