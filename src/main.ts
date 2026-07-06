#!/usr/bin/env node
import {
  type CliRuntime,
  type InteractiveMode,
  cliInteractiveModes,
  cliReadRuntime,
  cliSetRuntime,
} from '@jib/cli'
import type { Argv, CommandModule } from 'yargs'
import yargs from 'yargs'
import { hideBin } from 'yargs/helpers'
import pkg from '../package.json' with { type: 'json' }
import addCommand from './cmd/add.ts'
import cloudflaredCommands from './cmd/cloudflared.ts'
import deployCommand from './cmd/deploy.ts'
import downCommand from './cmd/down.ts'
import envCommands from './cmd/env.ts'
import execCommand from './cmd/exec.ts'
import { cmdExitError } from './cmd/handler.ts'
import ingressCommands from './cmd/ingress.ts'
import initCommand from './cmd/init.ts'
import migrateCommand from './cmd/migrate.ts'
import removeCommand from './cmd/remove.ts'
import restartCommand from './cmd/restart.ts'
import runCommand from './cmd/run.ts'
import sourcesCommands from './cmd/sources.ts'
import statusCommand from './cmd/status.ts'
import upCommand from './cmd/up.ts'
import updateCommand from './cmd/update.ts'
import watchCommand from './cmd/watch.ts'

// Commands have different argv shapes; erase per-command argv types at the root registry boundary.
const cliCommands = [
  migrateCommand,
  initCommand,
  ...ingressCommands,
  addCommand,
  removeCommand,
  deployCommand,
  upCommand,
  downCommand,
  restartCommand,
  execCommand,
  runCommand,
  statusCommand,
  updateCommand,
  watchCommand,
  ...sourcesCommands,
  ...envCommands,
  ...cloudflaredCommands,
]

const SHARED_FILE_UMASK = 0o002

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

/** Keeps root-run git/docker side effects writable by the shared jib group. */
function configureSharedFileUmask(): void {
  process.umask(SHARED_FILE_UMASK)
}

/** Reads a yargs-validated prompt mode without preempting yargs choice errors. */
function readParsedInteractiveMode(value: unknown): InteractiveMode | undefined {
  return typeof value === 'string' && cliInteractiveModes.includes(value as InteractiveMode)
    ? (value as InteractiveMode)
    : undefined
}

/** Builds the root yargs parser with global runtime options and command registration. */
function createCliParser(rawArgs: string[], runtime: CliRuntime): Argv {
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
      if (nextRuntime instanceof Error) cmdExitError(nextRuntime)
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
  for (const command of cliCommands) parser.command(command as CommandModule)
  return parser
}

configureSharedFileUmask()

const runtime = cliReadRuntime()
if (runtime instanceof Error) cmdExitError(runtime)

const rawArgs = hideBin(process.argv)

try {
  const cliParser = createCliParser(rawArgs, runtime)
  await cliParser.parseAsync()
} catch (error) {
  cmdExitError(error)
}
