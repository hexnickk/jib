import { CliError } from '@jib/cli'
import { configLoadAppContext } from '@jib/config'
import { dockerComposeFor } from '@jib/docker'
import type { JibError } from '@jib/errors'
import type { ArgumentsCamelCase, CommandModule } from 'yargs'
import { cmdCreateHandler } from './handler.ts'

const cliLogsCommand = {
  command: 'logs <app> [service]',
  describe: 'Show container logs for an app',
  builder: (parser) =>
    parser
      .positional('app', { type: 'string', describe: 'App name' })
      .positional('service', { type: 'string', describe: 'Compose service name' })
      .option('follow', {
        alias: 'f',
        type: 'boolean',
        describe: 'Follow log output',
      })
      .option('tail', {
        alias: 'n',
        type: 'number',
        describe: 'Number of recent log lines to show',
      }),
  handler: cmdCreateHandler(logsRunCommand),
} satisfies CommandModule

/** Streams docker compose logs for one app, optionally narrowed to a service. */
async function logsRunCommand(
  args: ArgumentsCamelCase,
): Promise<
  JibError | CliError | { app: string; service?: string; followed: boolean; tail?: number }
> {
  if (typeof args.app !== 'string') {
    return new CliError('missing_app', 'missing app name — usage: jib logs <app> [service]')
  }
  const appName = args.app
  const service = typeof args.service === 'string' ? args.service : undefined
  const tail = typeof args.tail === 'number' ? args.tail : undefined
  if (tail !== undefined && (!Number.isInteger(tail) || tail < 1)) {
    return new CliError('invalid_tail', '--tail must be a positive integer')
  }

  const loaded = await configLoadAppContext(appName)
  if (loaded instanceof Error) {
    return loaded
  }
  const compose = dockerComposeFor(loaded.cfg, loaded.paths, appName)
  if (compose instanceof Error) {
    return compose
  }

  const logsError = await compose.logs(service, {
    follow: args.follow === true,
    ...(tail !== undefined && { tail }),
  })
  if (logsError) {
    return logsError
  }

  return {
    app: appName,
    ...(service !== undefined && { service }),
    followed: args.follow === true,
    ...(tail !== undefined && { tail }),
  }
}

export default cliLogsCommand
