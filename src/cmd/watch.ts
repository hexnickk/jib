import { runPollCycle, runPoller } from '@jib-module/watcher'
import { loadConfig } from '@jib/config'
import { createLogger } from '@jib/logging'
import { getPaths } from '@jib/paths'
import type { CliCommand } from './command.ts'

const cliWatchCommand = {
  command: 'watch',
  describe: 'Poll repos and auto-deploy changed apps',
  builder: {
    once: { type: 'boolean', description: 'Run one poll cycle and exit' },
  },
  async run(args) {
    const paths = getPaths()
    const log = createLogger('watch')
    const getConfig = () => loadConfig(paths.configFile)

    if (args.once) {
      await runPollCycle({ paths, getConfig, log })
      return { ran: true }
    }

    const abort = new AbortController()
    const shutdown = () => abort.abort()
    process.once('SIGTERM', shutdown)
    process.once('SIGINT', shutdown)
    await runPoller({ paths, getConfig, log }, abort.signal)
  },
} satisfies CliCommand

export default cliWatchCommand
