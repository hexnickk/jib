import { handleShellResult, parseRunArgsResult } from '@jib/docker'
import type { CliCommand } from './command.ts'

/** Reads the raw run argv tail so docker shell parsing can preserve passthrough syntax. */
function readRunTail(): string[] {
  return process.argv.slice(3)
}

const cliRunCommand = {
  command: 'run <app> [service] [cmd..]',
  describe: 'Run a one-off command in a new container',
  builder: (yargs) =>
    yargs
      .parserConfiguration({ 'unknown-options-as-args': true, 'populate--': true })
      .positional('app', { type: 'string', describe: 'App name' })
      .positional('service', {
        type: 'string',
        describe: 'Compose service (auto-detected for single-service apps)',
      })
      .positional('cmd', {
        type: 'string',
        array: true,
        describe: 'Command to run after --',
      }),
  async run() {
    const parsed = parseRunArgsResult(readRunTail())
    if (parsed instanceof Error) return parsed
    return await handleShellResult(parsed, 'run')
  },
} satisfies CliCommand

export default cliRunCommand
