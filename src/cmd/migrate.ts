import { existsSync } from 'node:fs'
import { cliCheckLinuxHost, cliCheckRootHost, cliIsTextOutput } from '@jib/cli'
import { getPaths } from '@jib/paths'
import { intro, note, outro } from '@jib/tui'
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

    const paths = getPaths()
    const configExisted = existsSync(paths.configFile)
    if (cliIsTextOutput()) intro('jib migrate')

    const result = await runPendingMigrations(paths)
    if (cliIsTextOutput()) {
      outro(
        result.appliedMigrations.length > 0
          ? `applied ${result.appliedMigrations.length} migration(s)`
          : 'nothing to do',
      )
      if (result.sessionReloadRecommended) {
        note(
          'You were added to the `jib` group. Start a new login session for group-based access to apply; until then, keep using `sudo`.',
          'Next steps',
        )
      }
    }

    return { ...result, configExisted }
  },
} satisfies CliCommand

export default cliMigrateCommand
