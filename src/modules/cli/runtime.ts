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

/** Reads the baseline runtime from env defaults and current TTY state. */
function readDefaultCliRuntime(): CliRuntime | CliError {
  const interactive = process.env.JIB_NON_INTERACTIVE
    ? 'never'
    : (cliReadInteractiveMode(process.env.JIB_INTERACTIVE) ?? 'auto')
  if (interactive instanceof Error) {
    return interactive
  }
  return {
    interactive,
    debug: ['1', 'true', 'yes', 'on'].includes((process.env.JIB_DEBUG ?? '').toLowerCase()),
    stdinTty: Boolean(process.stdin.isTTY),
    stdoutTty: Boolean(process.stdout.isTTY),
  }
}

/** Stores runtime overrides and mirrors debug mode to JIB_DEBUG for downstream logging. */
export function cliSetRuntime(runtime: Partial<CliRuntime>): CliRuntime | CliError {
  const defaults = readDefaultCliRuntime()
  if (defaults instanceof Error) {
    return defaults
  }
  currentCliRuntime = { ...defaults, ...runtime }
  if (currentCliRuntime.debug) {
    process.env.JIB_DEBUG = '1'
  } else {
    Reflect.deleteProperty(process.env, 'JIB_DEBUG')
  }
  return currentCliRuntime
}

/** Reads the current runtime or builds one from env defaults when unset. */
export function cliReadRuntime(): CliRuntime | CliError {
  return currentCliRuntime ?? readDefaultCliRuntime()
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
  const runtime = cliReadRuntime()
  return !(runtime instanceof Error) && cliRuntimeCanPrompt(runtime)
}

/** Explains why prompting is blocked, or returns null when prompting is allowed. */
export function cliDescribePromptBlock(): string | null {
  const runtime = cliReadRuntime()
  return runtime instanceof Error ? runtime.message : cliRuntimeDescribePromptBlock(runtime)
}

/** Returns whether debug logging is currently enabled. */
export function cliIsDebugEnabled(): boolean {
  const runtime = cliReadRuntime()
  return !(runtime instanceof Error) && runtime.debug === true
}
