import { watcherRunPollCycle, watcherRunPoller } from '@jib-module/watcher'
import { configLoad } from '@jib/config'
import { loggingCreateLogger } from '@jib/logging'
import { pathsGetPaths } from '@jib/paths'
import type { CliCommand } from './command.ts'

const cliWatchCommand = {
  command: 'watch',
  describe: 'Poll repos and auto-deploy changed apps',
  builder: {
    once: { type: 'boolean', description: 'Run one poll cycle and exit' },
  },
  async run(args) {
    const paths = pathsGetPaths()
    const log = loggingCreateLogger('watch')
    const getConfig = async () => {
      const config = await configLoad(paths.configFile)
      if (config instanceof Error) throw config
      return config
    }

    if (args.once) {
      await watcherRunPollCycle({ paths, getConfig, log })
      return { ran: true }
    }

    const abort = new AbortController()
    const shutdown = () => abort.abort()
    process.once('SIGTERM', shutdown)
    process.once('SIGINT', shutdown)
    await watcherRunPoller({ paths, getConfig, log }, abort.signal)
  },
} satisfies CliCommand

export default cliWatchCommand
