import { handleShellResult, parseExecArgsResult } from '@jib/docker'
import type { CliCommand } from './command.ts'

/** Reads the raw exec argv tail so docker shell parsing can preserve passthrough syntax. */
function readExecTail(): string[] {
  return process.argv.slice(3)
}

const cliExecCommand = {
  command: 'exec <app> [service] [cmd..]',
  describe: 'Execute command in a running container',
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
        describe: 'Command to execute after --',
      }),
  async run() {
    const parsed = parseExecArgsResult(readExecTail())
    if (parsed instanceof Error) return parsed
    return await handleShellResult(parsed, 'exec')
  },
} satisfies CliCommand

export default cliExecCommand
