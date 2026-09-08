import { existsSync } from 'node:fs'
import { writeFile } from 'node:fs/promises'
import { InternalError } from '@jib/errors'
import { MINIMAL_CONFIG } from './helpers.ts'
import type { JibMigration } from './types.ts'

export const m0002_ensure_config: JibMigration = {
  id: '0002_ensure_config',
  description: 'Write minimal config.yml if missing',
  async up(ctx) {
    if (existsSync(ctx.paths.configFile)) {
      return undefined
    }
    try {
      await writeFile(ctx.paths.configFile, MINIMAL_CONFIG, { mode: 0o640 })
      return undefined
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return new InternalError(`write initial config: ${message}`, { cause: error })
    }
  },
}
