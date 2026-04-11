import { existsSync } from 'node:fs'
import { applyCliArgs, ensureLinux, ensureRoot, isTextOutput, withCliArgs } from '@jib/cli'
import { getPaths } from '@jib/paths'
import { intro, note, outro } from '@jib/tui'
import { defineCommand } from 'citty'
import { runPendingMigrations } from '../migrations/service.ts'

export default defineCommand({
  meta: { name: 'migrate', description: 'Run automatic server migrations' },
  args: withCliArgs({}),
  async run({ args }) {
    applyCliArgs(args)
    ensureLinux('migrate')
    ensureRoot('migrate')

    const paths = getPaths()
    const configExisted = existsSync(paths.configFile)
    if (isTextOutput()) intro('jib migrate')

    const result = await runPendingMigrations(paths)
    if (isTextOutput()) {
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
})
