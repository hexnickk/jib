import { JibError, ValidationError } from './errors.ts'

export type InteractiveMode = 'auto' | 'always' | 'never'
export type OutputMode = 'text' | 'json'

export interface CliRuntime {
  interactive: InteractiveMode
  output: OutputMode
  debug: boolean
  stdinTty: boolean
  stdoutTty: boolean
}

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
    this.name = 'CliError'
    this.details = options.details
    this.exitCode = options.exitCode ?? 1
    this.hint = options.hint
    this.issues = options.issues
  }
}

export class MissingInputError extends CliError {
  constructor(message: string, issues: CliIssue[], options: Omit<CliErrorOptions, 'issues'> = {}) {
    super('missing_input', message, { ...options, issues })
    this.name = 'MissingInputError'
  }
}

let currentRuntime: CliRuntime | null = null

function parseTruthyEnv(value: string | undefined): boolean {
  if (!value) return false
  return ['1', 'true', 'yes', 'on'].includes(value.toLowerCase())
}

function parseStringFlag(rawArgs: string[], name: string): string | undefined {
  const boundary = runtimeArgBoundary(rawArgs)
  for (let i = boundary - 1; i >= 0; i--) {
    const arg = rawArgs[i]
    if (!arg) continue
    if (arg === `--${name}` && i + 1 < rawArgs.length) return rawArgs[i + 1]
    if (arg.startsWith(`--${name}=`)) return arg.slice(name.length + 3)
  }
  return undefined
}

function parseBooleanFlag(rawArgs: string[], name: string): boolean | undefined {
  const boundary = runtimeArgBoundary(rawArgs)
  for (let i = boundary - 1; i >= 0; i--) {
    const arg = rawArgs[i]
    if (!arg) continue
    if (arg === `--${name}`) return true
    if (arg === `--no-${name}`) return false
    if (arg.startsWith(`--${name}=`)) return parseTruthyEnv(arg.slice(name.length + 3))
  }
  return undefined
}

function shouldConsumeNextValue(rawArgs: string[], index: number): boolean {
  return index + 1 < rawArgs.length && !rawArgs[index + 1]?.startsWith('-')
}

function runtimeArgBoundary(rawArgs: string[]): number {
  const boundary = rawArgs.indexOf('--')
  return boundary >= 0 ? boundary : rawArgs.length
}

export function parseInteractiveMode(value: string | undefined): InteractiveMode | undefined {
  if (value === undefined) return undefined
  if (value === 'auto' || value === 'always' || value === 'never') return value
  throw new CliError('invalid_interactive_mode', `invalid --interactive value "${value}"`, {
    hint: 'expected one of: auto, always, never',
  })
}

export function parseOutputMode(value: string | undefined): OutputMode | undefined {
  if (value === undefined) return undefined
  if (value === 'text' || value === 'json') return value
  throw new CliError('invalid_output_mode', `invalid --output value "${value}"`, {
    hint: 'expected one of: text, json',
  })
}

function defaultInteractiveMode(): InteractiveMode {
  if (process.env.JIB_NON_INTERACTIVE) return 'never'
  return parseInteractiveMode(process.env.JIB_INTERACTIVE) ?? 'auto'
}

function defaultOutputMode(): OutputMode {
  return parseOutputMode(process.env.JIB_OUTPUT) ?? 'text'
}

function materializeRuntime(runtime: Partial<CliRuntime>): CliRuntime {
  return {
    interactive: runtime.interactive ?? defaultInteractiveMode(),
    output: runtime.output ?? defaultOutputMode(),
    debug: runtime.debug ?? parseTruthyEnv(process.env.JIB_DEBUG),
    stdinTty: runtime.stdinTty ?? Boolean(process.stdin.isTTY),
    stdoutTty: runtime.stdoutTty ?? Boolean(process.stdout.isTTY),
  }
}

export function configureCliRuntime(rawArgs: string[]): CliRuntime {
  const interactive = parseInteractiveMode(parseStringFlag(rawArgs, 'interactive'))
  const output = parseOutputMode(parseStringFlag(rawArgs, 'output'))
  const debug = parseBooleanFlag(rawArgs, 'debug')
  const next: Partial<CliRuntime> = {}
  if (interactive !== undefined) next.interactive = interactive
  if (output !== undefined) next.output = output
  if (debug !== undefined) next.debug = debug
  const runtime = materializeRuntime(next)
  setCliRuntime(runtime)
  return runtime
}

export function stripCliRuntimeArgs(rawArgs: string[]): string[] {
  const out: string[] = []
  const boundary = runtimeArgBoundary(rawArgs)
  for (let i = 0; i < boundary; i++) {
    const arg = rawArgs[i]
    if (!arg) continue
    if (arg === '--interactive' || arg === '--output') {
      if (shouldConsumeNextValue(rawArgs, i)) i++
      continue
    }
    if (
      arg === '--debug' ||
      arg === '--no-debug' ||
      arg.startsWith('--interactive=') ||
      arg.startsWith('--output=') ||
      arg.startsWith('--debug=') ||
      arg.startsWith('--no-debug=')
    ) {
      continue
    }
    out.push(arg)
  }
  if (boundary < rawArgs.length) {
    out.push(...rawArgs.slice(boundary))
  }
  return out
}

export function setCliRuntime(runtime: Partial<CliRuntime>): CliRuntime {
  currentRuntime = materializeRuntime(runtime)
  if (currentRuntime.debug) process.env.JIB_DEBUG = '1'
  else Reflect.deleteProperty(process.env, 'JIB_DEBUG')
  return currentRuntime
}

export function getCliRuntime(): CliRuntime {
  return currentRuntime ?? materializeRuntime({})
}

export function canPrompt(): boolean {
  const runtime = getCliRuntime()
  if (runtime.interactive === 'never') return false
  return runtime.stdinTty && runtime.stdoutTty
}

export function promptBlockReason(): string | null {
  const runtime = getCliRuntime()
  if (runtime.interactive === 'never')
    return 'interactive prompts are disabled by --interactive=never'
  if (!runtime.stdinTty || !runtime.stdoutTty) return 'interactive prompts require a TTY'
  return null
}

export function isJsonOutput(): boolean {
  return getCliRuntime().output === 'json'
}

export function isTextOutput(): boolean {
  return getCliRuntime().output === 'text'
}

export function isDebugEnabled(): boolean {
  return getCliRuntime().debug
}

export function assertCanPrompt(): void {
  const reason = promptBlockReason()
  if (reason) throw new ValidationError(reason)
}

export function normalizeCliError(error: unknown): NormalizedCliError {
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
