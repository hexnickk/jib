import { existsSync } from 'node:fs'
import { getPaths, isTextOutput } from '@jib/core'
import { intro, outro } from '@jib/tui'
import { defineCommand } from 'citty'
import { runPendingMigrations } from '../migrations/service.ts'
import { applyCliArgs, withCliArgs } from '../modules/runtime/cli-runtime.ts'
import { ensureLinux, ensureRoot } from '../modules/runtime/root.ts'

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
