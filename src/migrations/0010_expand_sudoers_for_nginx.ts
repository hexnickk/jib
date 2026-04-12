import { SUDOERS_PATH, buildSudoersContent, writeValidatedSudoers } from './helpers.ts'
import type { JibMigration } from './types.ts'

export const m0010_expand_sudoers_for_nginx: JibMigration = {
  id: '0010_expand_sudoers_for_nginx',
  description: 'Allow jib group to validate and reload nginx without password',
  up: async () => {
    await writeValidatedSudoers(SUDOERS_PATH, buildSudoersContent())
  },
}
