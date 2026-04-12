#!/usr/bin/env bun
import {
  CliError,
  cliApplyRuntimeArgv,
  cliIsJsonOutput,
  cliNormalizeError,
  cliReadRuntime,
} from '@jib/cli'
import yargs from 'yargs'
import { hideBin } from 'yargs/helpers'
import pkg from '../package.json' with { type: 'json' }
import addCommand from './cmd/add.ts'
import cloudflaredCommands from './cmd/cloudflared.ts'
import type { CliCommand, CliGlobalArgv } from './cmd/command.ts'
import { cliRegisterCommands } from './cmd/command.ts'
import deployCommand from './cmd/deploy.ts'
import downCommand from './cmd/down.ts'
import execCommand from './cmd/exec.ts'
import initCommand from './cmd/init.ts'
import migrateCommand from './cmd/migrate.ts'
import removeCommand from './cmd/remove.ts'
import restartCommand from './cmd/restart.ts'
import runCommand from './cmd/run.ts'
import secretsCommands from './cmd/secrets.ts'
import sourcesCommands from './cmd/sources.ts'
import statusCommand from './cmd/status.ts'
import upCommand from './cmd/up.ts'
import watchCommand from './cmd/watch.ts'

const cliCommands: CliCommand[] = [
  migrateCommand,
  initCommand,
  addCommand,
  removeCommand,
  deployCommand,
  upCommand,
  downCommand,
  restartCommand,
  execCommand,
  runCommand,
  statusCommand,
  watchCommand,
  ...sourcesCommands,
  ...secretsCommands,
  ...cloudflaredCommands,
]

const ESC = String.fromCharCode(27)
const ANSI_ESCAPE_RE = new RegExp(`${ESC}(?:[@-Z\\-_]|\\[[0-?]*[ -/]*[@-~])`, 'g')

/** Removes ANSI escape sequences before writing to a non-TTY stream. */
function stripAnsiText(value: string): string {
  return value.replaceAll(ANSI_ESCAPE_RE, '')
}

/** Writes a single line of text, stripping color when the stream is not a TTY. */
function writeCliText(stream: NodeJS.WriteStream, value: string): void {
  const text = stream.isTTY ? value : stripAnsiText(value)
  stream.write(text.endsWith('\n') ? text : `${text}\n`)
}

/** Recursively strips ANSI escape sequences from JSON payloads. */
function sanitizeCliJson(value: unknown): unknown {
  if (typeof value === 'string') return stripAnsiText(value)
  if (Array.isArray(value)) return value.map(sanitizeCliJson)
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, sanitizeCliJson(entry)]),
    )
  }
  return value
}

/** Writes a JSON response with ANSI-free string fields. */
function writeCliJson(stream: NodeJS.WriteStream, value: unknown): void {
  stream.write(`${JSON.stringify(sanitizeCliJson(value), null, 2)}\n`)
}

/** Renders a successful CLI response in text or JSON mode. */
function writeCliSuccess(value: unknown): void {
  if (cliIsJsonOutput()) {
    writeCliJson(process.stdout, { ok: true, data: value ?? null })
    return
  }
  if (typeof value === 'string') writeCliText(process.stdout, value)
}

/** Renders a normalized CLI error in text mode. */
function writeCliTextError(error: ReturnType<typeof cliNormalizeError>): void {
  writeCliText(process.stderr, error.message)
  for (const issue of error.issues ?? [])
    writeCliText(process.stderr, `${issue.field}: ${issue.message}`)
  if (error.hint) writeCliText(process.stderr, error.hint)
}

/** Renders a CLI error and exits with the normalized exit code. */
function exitCliError(error: unknown): never {
  const normalized = cliNormalizeError(error)
  if (cliIsJsonOutput()) writeCliJson(process.stderr, { ok: false, error: normalized })
  else writeCliTextError(normalized)
  process.exit(normalized.exitCode)
}

/** Builds the shared yargs option map for global CLI runtime flags. */
function createCliRuntimeOptions(runtime: Exclude<ReturnType<typeof cliReadRuntime>, Error>) {
  return {
    interactive: {
      type: 'string' as const,
      default: runtime.interactive,
      description: 'Prompt mode: auto|always|never',
      global: true,
    },
    output: {
      type: 'string' as const,
      default: runtime.output,
      description: 'Output mode: text|json',
      global: true,
    },
    debug: {
      type: 'boolean' as const,
      default: runtime.debug,
      description: 'Enable verbose diagnostics',
      global: true,
    },
  }
}

/** Parses only the global runtime flags so help/version honor text vs json output. */
function readCliRuntimeArgv(rawArgs: string[]) {
  const runtime = cliReadRuntime()
  if (runtime instanceof Error) throw runtime
  return yargs(rawArgs)
    .exitProcess(false)
    .help(false)
    .version(false)
    .parserConfiguration({ 'populate--': true })
    .options(createCliRuntimeOptions(runtime))
    .parseSync(rawArgs) as CliGlobalArgv
}

/** Builds the root yargs parser with global runtime options and command registration. */
function createCliParser(rawArgs: string[], onResult: (value: unknown) => void) {
  const runtime = cliReadRuntime()
  if (runtime instanceof Error) throw runtime
  return cliRegisterCommands(
    yargs(rawArgs)
      .scriptName('jib')
      .exitProcess(false)
      .showHelpOnFail(false)
      .parserConfiguration({ 'populate--': true })
      .strict()
      .demandCommand(1)
      .recommendCommands()
      .options(createCliRuntimeOptions(runtime))
      .middleware((argv) => {
        const nextRuntime = cliApplyRuntimeArgv(argv as CliGlobalArgv)
        if (nextRuntime instanceof Error) throw nextRuntime
      }, true)
      .fail((message, error) => {
        throw error ?? new CliError('invalid_cli_usage', message || 'invalid CLI usage')
      })
      .help()
      .version(pkg.version),
    cliCommands,
    onResult,
  )
}

const rawArgs = hideBin(process.argv)
let cliOutput = ''
let cliHelpRequested = false
let cliVersionRequested = false
let cliResult: unknown = undefined
let cliParseError: Error | undefined

try {
  const startupRuntime = cliApplyRuntimeArgv(readCliRuntimeArgv(rawArgs))
  if (startupRuntime instanceof Error) exitCliError(startupRuntime)
  await createCliParser(rawArgs, (value) => {
    cliResult = value
  }).parseAsync(rawArgs, {}, (error, argv, output) => {
    cliParseError = error ?? undefined
    cliHelpRequested = Boolean(argv?.help)
    cliVersionRequested = Boolean(argv?.version)
    cliOutput = output
  })
} catch (error) {
  exitCliError(error)
}

if (cliParseError) exitCliError(cliParseError)
if (cliResult instanceof Error) exitCliError(cliResult)
if (cliOutput) {
  if (cliVersionRequested)
    writeCliSuccess(cliIsJsonOutput() ? { version: cliOutput.trim() } : cliOutput)
  else if (cliHelpRequested) writeCliSuccess(cliIsJsonOutput() ? { usage: cliOutput } : cliOutput)
  else writeCliSuccess(cliOutput)
  process.exit(0)
}
writeCliSuccess(cliResult)
