import { watcherRunPollCycle, watcherRunPoller } from '@jib-module/watcher'
import { configLoad } from '@jib/config'
import { loggingCreateLogger } from '@jib/logging'
import { pathsGetPaths } from '@jib/paths'
import type { ArgumentsCamelCase, CommandModule } from 'yargs'
import { cmdCreateHandler } from './handler.ts'

const cliWatchCommand = {
  command: 'watch',
  // Hidden from CLI help because systemd invokes this internal worker command.
  describe: false,
  builder: {
    once: { type: 'boolean', description: 'Run one poll cycle and exit' },
  },
  handler: cmdCreateHandler(watchRunCommand),
} satisfies CommandModule<Record<string, unknown>, { once?: boolean }>

/** Runs the internal watch worker once or continuously until it is aborted. */
async function watchRunCommand(args: ArgumentsCamelCase<{ once?: boolean }>) {
  const paths = pathsGetPaths()
  const log = loggingCreateLogger('watch')
  const getConfig = () => configLoad(paths.configFile)

  if (args.once) {
    const result = await watcherRunPollCycle({ paths, getConfig, log })
    if (result instanceof Error) {
      return result
    }
    return { ran: true }
  }

  const abort = new AbortController()
  const shutdown = () => abort.abort()
  process.once('SIGTERM', shutdown)
  process.once('SIGINT', shutdown)
  return await watcherRunPoller({ paths, getConfig, log }, abort.signal)
}

export default cliWatchCommand
