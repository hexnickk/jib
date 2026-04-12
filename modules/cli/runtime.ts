import { ValidationError } from '@jib/errors'
import { CliError, InvalidInteractiveModeError, InvalidOutputModeError } from './errors.ts'

export type InteractiveMode = 'auto' | 'always' | 'never'
export type OutputMode = 'text' | 'json'

export interface CliRuntime {
  interactive: InteractiveMode
  output: OutputMode
  debug: boolean
  stdinTty: boolean
  stdoutTty: boolean
}

export type CliRuntimeParseError = InvalidInteractiveModeError | InvalidOutputModeError

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
  const parsed = parseInteractiveModeValue(value)
  if (parsed instanceof InvalidInteractiveModeError) throw parsed
  return parsed
}

function parseInteractiveModeValue(
  value: string | undefined,
): InteractiveMode | InvalidInteractiveModeError | undefined {
  if (value === undefined) return undefined
  if (value === 'auto' || value === 'always' || value === 'never') return value
  return new InvalidInteractiveModeError(value)
}

export function parseOutputMode(value: string | undefined): OutputMode | undefined {
  const parsed = parseOutputModeValue(value)
  if (parsed instanceof InvalidOutputModeError) throw parsed
  return parsed
}

function parseOutputModeValue(
  value: string | undefined,
): OutputMode | InvalidOutputModeError | undefined {
  if (value === undefined) return undefined
  if (value === 'text' || value === 'json') return value
  return new InvalidOutputModeError(value)
}

function defaultInteractiveMode(): InteractiveMode | InvalidInteractiveModeError {
  if (process.env.JIB_NON_INTERACTIVE) return 'never'
  const interactive = parseInteractiveModeValue(process.env.JIB_INTERACTIVE)
  if (interactive instanceof InvalidInteractiveModeError) return interactive
  return interactive ?? 'auto'
}

function defaultOutputMode(): OutputMode | InvalidOutputModeError {
  const output = parseOutputModeValue(process.env.JIB_OUTPUT)
  if (output instanceof InvalidOutputModeError) return output
  return output ?? 'text'
}

function materializeRuntime(runtime: Partial<CliRuntime>): CliRuntime | CliRuntimeParseError {
  const interactive = runtime.interactive ?? defaultInteractiveMode()
  if (interactive instanceof InvalidInteractiveModeError) return interactive
  const output = runtime.output ?? defaultOutputMode()
  if (output instanceof InvalidOutputModeError) return output
  return {
    interactive,
    output,
    debug: runtime.debug ?? parseTruthyEnv(process.env.JIB_DEBUG),
    stdinTty: runtime.stdinTty ?? Boolean(process.stdin.isTTY),
    stdoutTty: runtime.stdoutTty ?? Boolean(process.stdout.isTTY),
  }
}

export function configureCliRuntime(rawArgs: string[]): CliRuntime | CliRuntimeParseError {
  const interactive = parseInteractiveModeValue(parseStringFlag(rawArgs, 'interactive'))
  if (interactive instanceof InvalidInteractiveModeError) return interactive
  const output = parseOutputModeValue(parseStringFlag(rawArgs, 'output'))
  if (output instanceof InvalidOutputModeError) return output
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

export function setCliRuntime(runtime: Partial<CliRuntime>): CliRuntime | CliRuntimeParseError {
  const nextRuntime = materializeRuntime(runtime)
  if (nextRuntime instanceof CliError) return nextRuntime
  currentRuntime = nextRuntime
  if (currentRuntime.debug) process.env.JIB_DEBUG = '1'
  else Reflect.deleteProperty(process.env, 'JIB_DEBUG')
  return currentRuntime
}

export function getCliRuntime(): CliRuntime {
  const runtime = currentRuntime ?? materializeRuntime({})
  if (runtime instanceof CliError) throw runtime
  return runtime
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
