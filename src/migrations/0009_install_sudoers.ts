import { SUDOERS_PATH, buildSudoersContent, writeValidatedSudoers } from './helpers.ts'
import type { JibMigration } from './types.ts'

export const m0009_install_sudoers: JibMigration = {
  id: '0009_install_sudoers',
  description: 'Write /etc/sudoers.d/jib drop-in',
  up: async () => {
    await writeValidatedSudoers(SUDOERS_PATH, buildSudoersContent())
  },
}
