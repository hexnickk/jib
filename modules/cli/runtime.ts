import { ValidationError } from '@jib/errors'
import { CliError } from './errors.ts'

export type InteractiveMode = 'auto' | 'always' | 'never'
export type OutputMode = 'text' | 'json'

export interface CliRuntime {
  interactive: InteractiveMode
  output: OutputMode
  debug: boolean
  stdinTty: boolean
  stdoutTty: boolean
}

let currentRuntime: CliRuntime | null = null

function parseTruthyEnv(value: string | undefined): boolean {
  if (!value) return false
  return ['1', 'true', 'yes', 'on'].includes(value.toLowerCase())
}

function runtimeArgBoundary(rawArgs: string[]): number {
  const boundary = rawArgs.indexOf('--')
  return boundary >= 0 ? boundary : rawArgs.length
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
  return setCliRuntime(next)
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
  return boundary < rawArgs.length ? [...out, ...rawArgs.slice(boundary)] : out
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
  if (runtime.interactive === 'never') {
    return 'interactive prompts are disabled by --interactive=never'
  }
  return !runtime.stdinTty || !runtime.stdoutTty ? 'interactive prompts require a TTY' : null
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
