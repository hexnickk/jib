import type { ArgsDef, CommandDef, Resolvable, SubCommandsDef } from 'citty'
import { defineCommand, renderUsage, runCommand } from 'citty'
import { CliError, normalizeCliError } from './errors.ts'
import {
  canPrompt,
  configureCliRuntime,
  getCliRuntime,
  isJsonOutput,
  stripCliRuntimeArgs,
} from './runtime.ts'

const ESC = String.fromCharCode(27)
const ANSI_ESCAPE_RE = new RegExp(`${ESC}(?:[@-Z\\\\-_]|\\[[0-?]*[ -/]*[@-~])`, 'g')

interface CommandNode {
  subCommands?: Record<string, CommandNode>
}

export interface CommandAppOptions {
  name: string
  version: string
  description: string
  args?: Resolvable<ArgsDef>
  subCommands: SubCommandsDef
}

function stripAnsi(value: string): string {
  return value.replaceAll(ANSI_ESCAPE_RE, '')
}

function writeText(stream: NodeJS.WriteStream, value: string): void {
  const text = stream.isTTY ? value : stripAnsi(value)
  stream.write(text.endsWith('\n') ? text : `${text}\n`)
}

function sanitizeJsonValue(value: unknown): unknown {
  if (typeof value === 'string') return stripAnsi(value)
  if (Array.isArray(value)) return value.map(sanitizeJsonValue)
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, sanitizeJsonValue(entry)]),
    )
  }
  return value
}

function printJson(stream: NodeJS.WriteStream, value: unknown): void {
  stream.write(`${JSON.stringify(sanitizeJsonValue(value), null, 2)}\n`)
}

async function resolveCommandInvocation(
  cmd: CommandNode,
  rawArgs: string[],
  parent?: CommandNode,
): Promise<{ leaf: CommandNode; parent: CommandNode | undefined; leafArgs: string[] }> {
  const subCommands = cmd.subCommands ?? {}
  const subCommandIndex = rawArgs.findIndex((arg) => !arg.startsWith('-'))
  const name = subCommandIndex >= 0 ? rawArgs[subCommandIndex] : undefined
  if (name === undefined || !subCommands[name]) return { leaf: cmd, parent, leafArgs: rawArgs }
  return resolveCommandInvocation(subCommands[name], rawArgs.slice(subCommandIndex + 1), cmd)
}

function renderTextError(error: ReturnType<typeof normalizeCliError>): void {
  writeText(process.stderr, error.message)
  for (const issue of error.issues ?? []) {
    writeText(process.stderr, `${issue.field}: ${issue.message}`)
  }
  if (error.hint) writeText(process.stderr, error.hint)
}

function runtimeArgBoundary(rawArgs: string[]): number {
  const boundary = rawArgs.indexOf('--')
  return boundary >= 0 ? boundary : rawArgs.length
}

function prefersJsonOutput(rawArgs: string[]): boolean {
  const boundary = runtimeArgBoundary(rawArgs)
  for (let i = boundary - 1; i >= 0; i--) {
    const arg = rawArgs[i]
    if (!arg) continue
    if (arg === '--output' && i + 1 < boundary) return rawArgs[i + 1] === 'json'
    if (arg.startsWith('--output=')) return arg.slice('--output='.length) === 'json'
  }
  return process.env.JIB_OUTPUT === 'json'
}

function currentJsonOutput(): boolean {
  try {
    return isJsonOutput()
  } catch {
    return false
  }
}

function exitWithError(error: unknown, jsonOutput = currentJsonOutput()): void {
  const normalized = normalizeCliError(error)
  if (jsonOutput) {
    printJson(process.stderr, { ok: false, error: normalized })
  } else {
    renderTextError(normalized)
  }
  process.exit(normalized.exitCode)
}

function printSuccess(value: unknown): void {
  if (isJsonOutput()) {
    printJson(process.stdout, { ok: true, data: value ?? null })
    return
  }
  if (typeof value === 'string') writeText(process.stdout, value)
}

function shouldRenderBareCommandUsage(cmd: CommandNode, leafArgs: string[]): boolean {
  if (isJsonOutput()) return false
  const runtime = getCliRuntime()
  if (runtime.interactive !== 'always' && !canPrompt()) return false
  return leafArgs.length === 0 && Object.keys(cmd.subCommands ?? {}).length > 0
}

export async function runCommandApp(options: CommandAppOptions): Promise<void> {
  const mainDef: CommandDef<ArgsDef> = {
    meta: {
      name: options.name,
      version: options.version,
      description: options.description,
    },
    subCommands: options.subCommands,
  }
  if (options.args) mainDef.args = options.args
  const main = defineCommand(mainDef)
  const rawArgs = process.argv.slice(2)

  try {
    const runtime = configureCliRuntime(rawArgs)
    if (runtime instanceof CliError) {
      exitWithError(runtime, prefersJsonOutput(rawArgs))
      return
    }
    const sanitizedArgs = stripCliRuntimeArgs(rawArgs)

    if (sanitizedArgs.includes('--help') || sanitizedArgs.includes('-h')) {
      const { leaf, parent } = await resolveCommandInvocation(main as CommandNode, sanitizedArgs)
      const usage = `${await renderUsage(leaf as CommandDef, parent as CommandDef | undefined)}\n`
      printSuccess(isJsonOutput() ? { usage } : usage)
      return
    }

    if (sanitizedArgs.length === 1 && sanitizedArgs[0] === '--version') {
      printSuccess(isJsonOutput() ? { version: options.version } : options.version)
      return
    }

    const { leaf, leafArgs, parent } = await resolveCommandInvocation(
      main as CommandNode,
      sanitizedArgs,
    )
    if (shouldRenderBareCommandUsage(leaf, leafArgs)) {
      const usage = `${await renderUsage(leaf as CommandDef, parent as CommandDef | undefined)}\n`
      printSuccess(usage)
      return
    }

    const { result } = await runCommand(leaf as CommandDef, { rawArgs: leafArgs })
    printSuccess(result)
  } catch (error) {
    exitWithError(error)
  }
}
