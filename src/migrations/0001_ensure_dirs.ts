import { mkdir } from 'node:fs/promises'
import type { JibMigration } from './types.ts'

export const m0001_ensure_dirs: JibMigration = {
  id: '0001_ensure_dirs',
  description: 'Create $JIB_ROOT subdirectories',
  up: async (ctx) => {
    const p = ctx.paths
    const dirs = [
      p.root,
      p.stateDir,
      p.locksDir,
      p.secretsDir,
      p.overridesDir,
      p.reposDir,
      p.repoRoot,
      p.nginxDir,
      p.cloudflaredDir,
    ]
    for (const d of dirs) await mkdir(d, { recursive: true, mode: 0o750 })
  },
}
