import { mkdir } from 'node:fs/promises'
import { InternalError } from '@jib/errors'
import type { JibMigration } from './types.ts'

export const m0001_ensure_dirs: JibMigration = {
  id: '0001_ensure_dirs',
  description: 'Create $JIB_ROOT subdirectories',
  async up(ctx) {
    const paths = ctx.paths
    const directories = [
      paths.root,
      paths.stateDir,
      paths.locksDir,
      paths.secretsDir,
      paths.overridesDir,
      paths.reposDir,
      paths.repoRoot,
      paths.nginxDir,
      paths.cloudflaredDir,
    ]
    try {
      for (const directory of directories) {
        await mkdir(directory, { recursive: true, mode: 0o750 })
      }
      return undefined
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return new InternalError(`create migration directories: ${message}`, { cause: error })
    }
  },
}
