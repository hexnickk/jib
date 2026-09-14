import { dockerRunApp, dockerParseRunArgs } from '@jib/docker'
import type { CommandModule } from 'yargs'
import { cmdCreateHandler } from './handler.ts'

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
  handler: cmdCreateHandler(runRunCommand),
} satisfies CommandModule

/** Runs docker run passthrough parsing and returns a shell result or typed error. */
async function runRunCommand() {
  const parsed = dockerParseRunArgs(process.argv.slice(3))
  if (parsed instanceof Error) {
    return parsed
  }
  return dockerRunApp(parsed)
}

export default cliRunCommand
