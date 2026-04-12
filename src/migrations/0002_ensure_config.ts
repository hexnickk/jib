import { existsSync } from 'node:fs'
import { writeFile } from 'node:fs/promises'
import { MINIMAL_CONFIG } from './helpers.ts'
import type { JibMigration } from './types.ts'

export const m0002_ensure_config: JibMigration = {
  id: '0002_ensure_config',
  description: 'Write minimal config.yml if missing',
  up: async (ctx) => {
    if (!existsSync(ctx.paths.configFile)) {
      await writeFile(ctx.paths.configFile, MINIMAL_CONFIG, { mode: 0o640 })
    }
  },
}
