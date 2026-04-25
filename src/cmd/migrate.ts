import { existsSync } from 'node:fs'
import { cliCheckLinuxHost, cliCheckRootHost, cliIsTextOutput } from '@jib/cli'
import { pathsGetPaths } from '@jib/paths'
import { tuiIntro, tuiNote, tuiOutro } from '@jib/tui'
import { runPendingMigrations } from '../migrations/service.ts'
import type { CliCommand } from './command.ts'

const cliMigrateCommand = {
  command: 'migrate',
  describe: 'Run automatic server migrations',
  async run() {
    const linuxError = cliCheckLinuxHost('migrate')
    if (linuxError) return linuxError
    const rootError = cliCheckRootHost('migrate')
    if (rootError) return rootError

    const paths = pathsGetPaths()
    const configExisted = existsSync(paths.configFile)
    if (cliIsTextOutput()) tuiIntro('jib migrate')

    const result = await runPendingMigrations(paths)
    if (cliIsTextOutput()) {
      tuiOutro(
        result.appliedMigrations.length > 0
          ? `applied ${result.appliedMigrations.length} migration(s)`
          : 'nothing to do',
      )
      if (result.sessionReloadRecommended) {
        tuiNote(
          'You were added to the `jib` group. Reload group membership with `newgrp jib`, or start a new login session; until then, keep using `sudo`.',
          'Next steps',
        )
      }
    }

    return { ...result, configExisted }
  },
} satisfies CliCommand

export default cliMigrateCommand
