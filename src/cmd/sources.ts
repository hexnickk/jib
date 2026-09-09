import { configLoad } from '@jib/config'
import { pathsGetPaths } from '@jib/paths'
import { sourcesSetupRef } from '@jib/sources'
import { tuiPromptSelectResult } from '@jib/tui'
import type { CommandModule } from 'yargs'
import { cmdCreateHandler } from './handler.ts'

const cliSourcesCommands = [
  {
    command: 'sources setup',
    describe: 'Set up a git source ref',
    handler: cmdCreateHandler(sourcesSetupRunCommand),
  },
] satisfies CommandModule[]

/** Runs interactive source reference setup. */
async function sourcesSetupRunCommand() {
  const paths = pathsGetPaths()
  const config = await configLoad(paths.configFile)
  if (config instanceof Error) {
    return config
  }
  const source = await sourcesSetupRef(config, paths, { promptSelect: tuiPromptSelectResult })
  if (source instanceof Error) {
    return source
  }
}

export default cliSourcesCommands
