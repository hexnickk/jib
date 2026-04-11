import { existsSync } from 'node:fs'
import { applyCliArgs, ensureLinux, ensureRoot, isTextOutput, withCliArgs } from '@jib/cli'
import { getPaths } from '@jib/paths'
import { intro, outro } from '@jib/tui'
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

    const applied = await runPendingMigrations(paths)
    if (isTextOutput()) {
      outro(applied.length > 0 ? `applied ${applied.length} migration(s)` : 'nothing to do')
    }

    return { appliedMigrations: applied, configExisted }
  },
})
