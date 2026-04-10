import { runPollCycle, runPoller } from '@jib-module/watcher'
import { loadConfig } from '@jib/config'
import { createLogger, getPaths } from '@jib/core'
import { defineCommand } from 'citty'
import { applyCliArgs, withCliArgs } from '../../../src/cli-runtime.ts'

export default defineCommand({
  meta: { name: 'watch', description: 'Poll repos and auto-deploy changed apps' },
  args: withCliArgs({
    once: { type: 'boolean', description: 'Run one poll cycle and exit' },
  }),
  async run({ args }) {
    applyCliArgs(args)
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
})
