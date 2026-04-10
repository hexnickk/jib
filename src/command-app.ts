import {
  type CliIssue,
  canPrompt,
  configureCliRuntime,
  getCliRuntime,
  isJsonOutput,
  normalizeCliError,
  stripCliRuntimeArgs,
} from '@jib/core'
import type { ArgsDef, CommandDef, Resolvable, SubCommandsDef } from 'citty'
import { defineCommand, renderUsage, runCommand } from 'citty'
import { consola } from 'consola'

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
  consola.error(error.message)
  for (const issue of error.issues ?? ([] as CliIssue[])) {
    consola.error(`${issue.field}: ${issue.message}`)
  }
  if (error.hint) consola.error(error.hint)
}

function printSuccess(value: unknown): void {
  if (isJsonOutput()) {
    printJson(process.stdout, { ok: true, data: value ?? null })
    return
  }
  if (typeof value === 'string') {
    process.stdout.write(value.endsWith('\n') ? value : `${value}\n`)
  }
}

function hasSubCommands(cmd: CommandNode): boolean {
  return Object.keys(cmd.subCommands ?? {}).length > 0
}

function shouldRenderBareCommandUsage(cmd: CommandNode, leafArgs: string[]): boolean {
  if (isJsonOutput()) return false
  const runtime = getCliRuntime()
  if (runtime.interactive !== 'always' && !canPrompt()) return false
  return leafArgs.length === 0 && hasSubCommands(cmd)
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

  try {
    const rawArgs = process.argv.slice(2)
    configureCliRuntime(rawArgs)
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
    const normalized = normalizeCliError(error)
    if (isJsonOutput()) {
      printJson(process.stderr, { ok: false, error: normalized })
    } else {
      renderTextError(normalized)
    }
    process.exit(normalized.exitCode)
  }
}
