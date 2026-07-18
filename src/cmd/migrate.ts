import { existsSync } from 'node:fs'
import { cliCheckLinuxHost, cliCheckRootHost, cliIsTextOutput } from '@jib/cli'
import { pathsGetPaths } from '@jib/paths'
import { tuiIntro, tuiNote, tuiOutro } from '@jib/tui'
import type { CommandModule } from 'yargs'
import { runPendingMigrations } from '../migrations/service.ts'
import { cmdCreateHandler } from './handler.ts'

const cliMigrateCommand = {
  command: 'migrate',
  describe: 'Run automatic server migrations',
  handler: cmdCreateHandler(migrateRunCommand),
} satisfies CommandModule

/** Runs pending migrations and returns the migration summary or typed error. */
async function migrateRunCommand() {
  const linuxError = cliCheckLinuxHost('migrate')
  if (linuxError) {
    return linuxError
  }
  const rootError = cliCheckRootHost('migrate')
  if (rootError) {
    return rootError
  }

  const paths = pathsGetPaths()
  const configExisted = existsSync(paths.configFile)
  if (cliIsTextOutput()) {
    tuiIntro('jib migrate')
  }

  const result = await runPendingMigrations(paths)
  if (result instanceof Error) {
    return result
  }
  if (cliIsTextOutput()) {
    tuiOutro(
      result.appliedMigrations.length > 0
        ? `applied ${result.appliedMigrations.length} migration(s)`
        : 'nothing to do',
    )
    if (result.sessionReloadGroups.length > 0) {
      const label = result.sessionReloadGroups.length === 1 ? 'group' : 'groups'
      const groups = result.sessionReloadGroups.map((group) => `\`${group}\``).join(', ')
      tuiNote(
        `You were added to new ${label}: ${groups}. Start a new login session so the memberships are active; until then, keep using \`sudo\`.`,
        'Next steps',
      )
    }
  }

  return { ...result, configExisted }
}

export default cliMigrateCommand
