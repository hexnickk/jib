import type { ArgsDef, ParsedArgs } from 'citty'
import { type CliIssue, MissingInputError } from './errors.ts'
import {
  type InteractiveMode,
  type OutputMode,
  getCliRuntime,
  parseInteractiveMode,
  parseOutputMode,
  setCliRuntime,
} from './runtime.ts'

export const commonCliArgs = {
  interactive: {
    type: 'string',
    description: 'Prompt mode: auto|always|never',
  },
  output: {
    type: 'string',
    description: 'Output mode: text|json',
  },
  debug: {
    type: 'boolean',
    description: 'Enable verbose diagnostics',
  },
} as const satisfies ArgsDef

type MaybeCliArgs = ParsedArgs<ArgsDef> & {
  interactive?: string
  output?: string
  debug?: boolean
}

export function withCliArgs<T extends ArgsDef>(args: T): T & typeof commonCliArgs {
  return { ...commonCliArgs, ...args }
}

export function applyCliArgs(args: MaybeCliArgs): void {
  const current = getCliRuntime()
  const next: { interactive: InteractiveMode; output: OutputMode; debug: boolean } = {
    interactive: current.interactive,
    output: current.output,
    debug: current.debug,
  }
  const interactive = parseInteractiveMode(args.interactive)
  const output = parseOutputMode(args.output)
  if (interactive !== undefined) next.interactive = interactive
  if (output !== undefined) next.output = output
  if (args.debug !== undefined) next.debug = args.debug
  setCliRuntime(next)
}

export function missingInput(message: string, issues: CliIssue[]): never {
  throw new MissingInputError(message, issues)
}
