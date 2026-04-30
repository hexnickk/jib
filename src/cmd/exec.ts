import { dockerHandleShell, dockerParseExecArgs } from '@jib/docker'
import type { CommandModule } from 'yargs'
import { cmdCreateHandler } from './handler.ts'

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
  handler: cmdCreateHandler(execRunCommand),
} satisfies CommandModule

/** Runs docker exec passthrough parsing and returns a shell result or typed error. */
async function execRunCommand() {
  const parsed = dockerParseExecArgs(readExecTail())
  if (parsed instanceof Error) return parsed
  return await dockerHandleShell(parsed, 'exec')
}

export default cliExecCommand
