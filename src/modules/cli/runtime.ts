import { CliError } from './errors.ts'

export const cliInteractiveModes = ['auto', 'always', 'never'] as const

export type InteractiveMode = (typeof cliInteractiveModes)[number]

export interface CliRuntime {
  interactive: InteractiveMode
  debug: boolean
  stdinTty: boolean
  stdoutTty: boolean
}

let currentCliRuntime: CliRuntime | null = null

/** Parses shell-style truthy env values like 1/true/yes/on. */
function parseTruthyCliEnv(value: string | undefined): boolean {
  if (!value) {
    return false
  }
  return ['1', 'true', 'yes', 'on'].includes(value.toLowerCase())
}

/** Parses a raw interactive-mode string into a typed mode or a typed error. */
export function cliReadInteractiveMode(
  value: string | undefined,
): InteractiveMode | CliError | undefined {
  if (value === undefined) {
    return undefined
  }
  if (value === 'auto' || value === 'always' || value === 'never') {
    return value
  }
  return new CliError('invalid_interactive_mode', `invalid --interactive value "${value}"`, {
    hint: 'expected one of: auto, always, never',
  })
}

/** Reads the default interactive mode from env, honoring JIB_NON_INTERACTIVE. */
function readDefaultCliInteractiveMode(): InteractiveMode | CliError {
  if (process.env.JIB_NON_INTERACTIVE) {
    return 'never'
  }
  return cliReadInteractiveMode(process.env.JIB_INTERACTIVE) ?? 'auto'
}

/** Reads the baseline runtime from env defaults and current TTY state. */
function readDefaultCliRuntime(): CliRuntime | CliError {
  const interactive = readDefaultCliInteractiveMode()
  if (interactive instanceof Error) {
    return interactive
  }
  return {
    interactive,
    debug: parseTruthyCliEnv(process.env.JIB_DEBUG),
    stdinTty: Boolean(process.stdin.isTTY),
    stdoutTty: Boolean(process.stdout.isTTY),
  }
}

/** Applies explicit overrides on top of the default runtime snapshot. */
function resolveCliRuntime(runtime: Partial<CliRuntime>): CliRuntime | CliError {
  const defaults = readDefaultCliRuntime()
  if (defaults instanceof Error) {
    return defaults
  }
  return { ...defaults, ...runtime }
}

/** Mirrors the current debug mode into JIB_DEBUG for downstream logging helpers. */
function syncCliDebugEnv(debug: boolean): void {
  if (debug) {
    process.env.JIB_DEBUG = '1'
  } else {
    Reflect.deleteProperty(process.env, 'JIB_DEBUG')
  }
}

/** Stores a partial runtime and returns the fully materialized runtime. */
export function cliSetRuntime(runtime: Partial<CliRuntime>): CliRuntime | CliError {
  const nextRuntime = resolveCliRuntime(runtime)
  if (nextRuntime instanceof Error) {
    return nextRuntime
  }
  currentCliRuntime = nextRuntime
  syncCliDebugEnv(nextRuntime.debug)
  return currentCliRuntime
}

/** Reads the current runtime or builds one from env defaults when unset. */
export function cliReadRuntime(): CliRuntime | CliError {
  return currentCliRuntime ?? readDefaultCliRuntime()
}

/** Returns the active runtime when parsing succeeded, otherwise null. */
function readReadyCliRuntime(): CliRuntime | null {
  const runtime = cliReadRuntime()
  return runtime instanceof Error ? null : runtime
}

/** Returns whether a resolved runtime allows prompts on its configured stdio streams. */
export function cliRuntimeCanPrompt(runtime: CliRuntime): boolean {
  if (runtime.interactive === 'never') {
    return false
  }
  return runtime.stdinTty && runtime.stdoutTty
}

/** Explains why a resolved runtime blocks prompts, or returns null when prompting is allowed. */
export function cliRuntimeDescribePromptBlock(runtime: CliRuntime): string | null {
  if (runtime.interactive === 'never') {
    return 'interactive prompts are disabled by --interactive=never'
  }
  return !runtime.stdinTty || !runtime.stdoutTty ? 'interactive prompts require a TTY' : null
}

/** Returns whether prompting is currently allowed. */
export function cliCanPrompt(): boolean {
  const runtime = readReadyCliRuntime()
  return runtime ? cliRuntimeCanPrompt(runtime) : false
}

/** Explains why prompting is blocked, or returns null when prompting is allowed. */
export function cliDescribePromptBlock(): string | null {
  const runtime = cliReadRuntime()
  return runtime instanceof Error ? runtime.message : cliRuntimeDescribePromptBlock(runtime)
}

/** Returns whether CLI output should be written as text in the text-only CLI. */
export function cliIsTextOutput(): boolean {
  return true
}

/** Returns whether debug logging is currently enabled. */
export function cliIsDebugEnabled(): boolean {
  return readReadyCliRuntime()?.debug === true
}
