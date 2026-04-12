import { loadConfig } from '@jib/config'
import { getPaths } from '@jib/paths'
import { setupSourceRef } from '@jib/sources'
import { promptSelect } from '@jib/tui'
import type { CliCommand } from './command.ts'

const cliSourcesCommands = [
  {
    command: 'sources setup',
    describe: 'Set up a git source ref',
    async run() {
      const paths = getPaths()
      const config = await loadConfig(paths.configFile)
      const source = await setupSourceRef(config, paths, { promptSelect })
      return { ok: source !== null, ...(source ? { source } : {}) }
    },
  },
] satisfies CliCommand[]

export default cliSourcesCommands
