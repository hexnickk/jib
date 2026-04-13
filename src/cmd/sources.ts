import { configLoad } from '@jib/config'
import { getPaths } from '@jib/paths'
import { sourcesSetupRef } from '@jib/sources'
import { tuiPromptSelectResult } from '@jib/tui'
import type { CliCommand } from './command.ts'

const cliSourcesCommands = [
  {
    command: 'sources setup',
    describe: 'Set up a git source ref',
    async run() {
      const paths = getPaths()
      const config = await configLoad(paths.configFile)
      if (config instanceof Error) return config
      const source = await sourcesSetupRef(config, paths, { promptSelect: tuiPromptSelectResult })
      if (source instanceof Error) return source
      return { ok: source !== null, ...(source ? { source } : {}) }
    },
  },
] satisfies CliCommand[]

export default cliSourcesCommands
