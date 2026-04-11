import { existsSync } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import type { Paths } from '@jib/core'
import { openDb } from '@jib/state'
import { migrations, runJibMigrations } from './index.ts'

export function hasBootstrapState(paths: Paths): boolean {
  return existsSync(paths.configFile) && existsSync(join(paths.stateDir, 'jib.db'))
}

export async function runPendingMigrations(paths: Paths): Promise<string[]> {
  await mkdir(paths.root, { recursive: true, mode: 0o750 })
  await mkdir(paths.stateDir, { recursive: true, mode: 0o750 })
  return runJibMigrations({ db: openDb(paths.stateDir), paths }, migrations)
}
