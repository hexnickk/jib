import { InvalidInteractiveModeError, InvalidOutputModeError } from './errors.ts'

export const cliInteractiveModes = ['auto', 'always', 'never'] as const
export const cliOutputModes = ['text', 'json'] as const

export type InteractiveMode = (typeof cliInteractiveModes)[number]
export type OutputMode = (typeof cliOutputModes)[number]

export interface CliRuntime {
  interactive: InteractiveMode
  output: OutputMode
  debug: boolean
  stdinTty: boolean
  stdoutTty: boolean
}

export type CliRuntimeParseError = InvalidInteractiveModeError | InvalidOutputModeError

export interface CliRuntimeArgv {
  interactive?: unknown
  output?: unknown
  debug?: unknown
}

let currentCliRuntime: CliRuntime | null = null

/** Parses shell-style truthy env values like 1/true/yes/on. */
function parseTruthyCliEnv(value: string | undefined): boolean {
  if (!value) return false
  return ['1', 'true', 'yes', 'on'].includes(value.toLowerCase())
}

/** Parses a raw interactive-mode string into a typed mode or a typed error. */
export function cliReadInteractiveMode(
  value: string | undefined,
): InteractiveMode | InvalidInteractiveModeError | undefined {
  if (value === undefined) return undefined
  if (value === 'auto' || value === 'always' || value === 'never') return value
  return new InvalidInteractiveModeError(value)
}

/** Parses a raw output-mode string into a typed mode or a typed error. */
export function cliReadOutputMode(
  value: string | undefined,
): OutputMode | InvalidOutputModeError | undefined {
  if (value === undefined) return undefined
  if (value === 'text' || value === 'json') return value
  return new InvalidOutputModeError(value)
}

/** Reads the default interactive mode from env, honoring JIB_NON_INTERACTIVE. */
function readDefaultCliInteractiveMode(): InteractiveMode | InvalidInteractiveModeError {
  if (process.env.JIB_NON_INTERACTIVE) return 'never'
  return cliReadInteractiveMode(process.env.JIB_INTERACTIVE) ?? 'auto'
}

/** Reads the default output mode from env. */
function readDefaultCliOutputMode(): OutputMode | InvalidOutputModeError {
  return cliReadOutputMode(process.env.JIB_OUTPUT) ?? 'text'
}

/** Reads the baseline runtime from env defaults and current TTY state. */
function readDefaultCliRuntime(): CliRuntime | CliRuntimeParseError {
  const interactive = readDefaultCliInteractiveMode()
  if (interactive instanceof Error) return interactive
  const output = readDefaultCliOutputMode()
  if (output instanceof Error) return output
  return {
    interactive,
    output,
    debug: parseTruthyCliEnv(process.env.JIB_DEBUG),
    stdinTty: Boolean(process.stdin.isTTY),
    stdoutTty: Boolean(process.stdout.isTTY),
  }
}

/** Applies explicit overrides on top of the default runtime snapshot. */
function resolveCliRuntime(runtime: Partial<CliRuntime>): CliRuntime | CliRuntimeParseError {
  const defaults = readDefaultCliRuntime()
  if (defaults instanceof Error) return defaults
  return { ...defaults, ...runtime }
}

/** Mirrors the current debug mode into JIB_DEBUG for downstream logging helpers. */
function syncCliDebugEnv(debug: boolean): void {
  if (debug) process.env.JIB_DEBUG = '1'
  else Reflect.deleteProperty(process.env, 'JIB_DEBUG')
}

/** Stores a partial runtime and returns the fully materialized runtime. */
export function cliSetRuntime(runtime: Partial<CliRuntime>): CliRuntime | CliRuntimeParseError {
  const nextRuntime = resolveCliRuntime(runtime)
  if (nextRuntime instanceof Error) return nextRuntime
  currentCliRuntime = nextRuntime
  syncCliDebugEnv(nextRuntime.debug)
  return currentCliRuntime
}

/** Reads the current runtime or builds one from env defaults when unset. */
export function cliReadRuntime(): CliRuntime | CliRuntimeParseError {
  return currentCliRuntime ?? readDefaultCliRuntime()
}

/** Applies parsed yargs runtime options on top of the current CLI runtime. */
export function cliApplyRuntimeArgv(argv: CliRuntimeArgv): CliRuntime | CliRuntimeParseError {
  const current = cliReadRuntime()
  if (current instanceof Error) return current
  const interactive = cliReadInteractiveMode(
    typeof argv.interactive === 'string' ? argv.interactive : undefined,
  )
  if (interactive instanceof Error) return interactive
  const output = cliReadOutputMode(typeof argv.output === 'string' ? argv.output : undefined)
  if (output instanceof Error) return output
  return cliSetRuntime({
    interactive: interactive ?? current.interactive,
    output: output ?? current.output,
    debug: typeof argv.debug === 'boolean' ? argv.debug : current.debug,
    stdinTty: current.stdinTty,
    stdoutTty: current.stdoutTty,
  })
}

/** Returns the active runtime when parsing succeeded, otherwise null. */
function readReadyCliRuntime(): CliRuntime | null {
  const runtime = cliReadRuntime()
  return runtime instanceof Error ? null : runtime
}

/** Returns whether prompting is currently allowed. */
export function cliCanPrompt(): boolean {
  const runtime = readReadyCliRuntime()
  if (!runtime) return false
  if (runtime.interactive === 'never') return false
  return runtime.stdinTty && runtime.stdoutTty
}

/** Explains why prompting is blocked, or returns null when prompting is allowed. */
export function cliDescribePromptBlock(): string | null {
  const runtime = cliReadRuntime()
  if (runtime instanceof Error) return runtime.message
  if (runtime.interactive === 'never') {
    return 'interactive prompts are disabled by --interactive=never'
  }
  return !runtime.stdinTty || !runtime.stdoutTty ? 'interactive prompts require a TTY' : null
}

/** Returns whether CLI output should be written as JSON. */
export function cliIsJsonOutput(): boolean {
  return readReadyCliRuntime()?.output === 'json'
}

/** Returns whether CLI output should be written as text. */
export function cliIsTextOutput(): boolean {
  return !cliIsJsonOutput()
}

/** Returns whether debug logging is currently enabled. */
export function cliIsDebugEnabled(): boolean {
  return readReadyCliRuntime()?.debug === true
}
