#!/usr/bin/env bun
import {
  type CliRuntime,
  type InteractiveMode,
  cliInteractiveModes,
  cliNormalizeError,
  cliReadRuntime,
  cliSetRuntime,
} from '@jib/cli'
import type { ArgumentsCamelCase, Argv } from 'yargs'
import yargs from 'yargs'
import { hideBin } from 'yargs/helpers'
import pkg from '../package.json' with { type: 'json' }
import addCommand from './cmd/add.ts'
import cloudflaredCommands from './cmd/cloudflared.ts'
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
import type { CliCommand, CliGlobalArgv } from './cmd/types.ts'
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
  writeCliTextError(normalized)
  process.exit(normalized.exitCode)
}

/** Builds the shared yargs option map for global CLI runtime flags. */
function createCliRuntimeOptions(runtime: CliRuntime) {
  return {
    interactive: {
      choices: cliInteractiveModes,
      default: runtime.interactive,
      description: 'Prompt mode',
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

/** Reads a yargs-validated prompt mode without preempting yargs choice errors. */
function readParsedInteractiveMode(value: unknown): InteractiveMode | undefined {
  return typeof value === 'string' && cliInteractiveModes.includes(value as InteractiveMode)
    ? (value as InteractiveMode)
    : undefined
}

/** Registers one command and records its return value for top-level error handling. */
function registerCliCommand<TArgs extends {}>(
  parser: Argv<CliGlobalArgv>,
  command: CliCommand<TArgs>,
  onResult: (value: unknown) => void,
): Argv<CliGlobalArgv> {
  const handleCommand = async (argv: ArgumentsCamelCase<CliGlobalArgv & TArgs>) => {
    onResult(await command.run(argv))
  }
  if (!command.builder || typeof command.builder === 'function') {
    return parser.command<CliGlobalArgv & TArgs>(
      command.command,
      command.describe,
      command.builder ?? ((builder) => builder),
      handleCommand,
    )
  }
  return parser.command(command.command, command.describe, command.builder, async (argv) => {
    await handleCommand(argv as ArgumentsCamelCase<CliGlobalArgv & TArgs>)
  })
}

/** Builds the root yargs parser with global runtime options and command registration. */
function createCliParser(
  rawArgs: string[],
  runtime: CliRuntime,
  onResult: (value: unknown) => void,
): Argv<CliGlobalArgv> {
  const parser = yargs(rawArgs)
    .scriptName('jib')
    .usage('$0 <command>')
    .showHelpOnFail(true)
    .parserConfiguration({ 'populate--': true })
    .strict()
    .recommendCommands()
    .options(createCliRuntimeOptions(runtime))
    .middleware((argv) => {
      const nextRuntime = cliSetRuntime({
        interactive: readParsedInteractiveMode(argv.interactive) ?? runtime.interactive,
        debug: typeof argv.debug === 'boolean' ? argv.debug : runtime.debug,
        stdinTty: runtime.stdinTty,
        stdoutTty: runtime.stdoutTty,
      })
      if (nextRuntime instanceof Error) exitCliError(nextRuntime)
    }, true)
    .help()
    .version(pkg.version)
  parser.command(
    '$0',
    false,
    (builder) => builder,
    () => {
      parser.showHelp('log')
    },
  )
  for (const command of cliCommands) registerCliCommand(parser, command, onResult)
  return parser
}

const runtime = cliReadRuntime()
if (runtime instanceof Error) exitCliError(runtime)

const rawArgs = hideBin(process.argv)
let cliResult: unknown = undefined

try {
  const cliParser = createCliParser(rawArgs, runtime, (value) => {
    cliResult = value
  })
  await cliParser.parseAsync()
} catch (error) {
  exitCliError(error)
}

if (cliResult instanceof Error) exitCliError(cliResult)
