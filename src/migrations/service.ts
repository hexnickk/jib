import { existsSync } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import type { Paths } from '@jib/paths'
import { openDb } from '@jib/state'
import { migrations, runJibMigrations } from './index.ts'

const GROUP = 'jib'

interface GroupCheckDeps {
  run?: (args: string[]) => { exitCode: number; stdout: { toString(): string } }
}

export interface MigrationRunResult {
  appliedMigrations: string[]
  sessionReloadRecommended: boolean
}

export function hasBootstrapState(paths: Paths): boolean {
  return existsSync(paths.configFile) && existsSync(join(paths.stateDir, 'jib.db'))
}

export function userInGroup(
  user: string,
  group: string = GROUP,
  deps: GroupCheckDeps = {},
): boolean {
  const run = deps.run ?? ((args) => Bun.spawnSync(args))
  const result = run(['id', '-nG', user])
  if (result.exitCode !== 0) return false
  return result.stdout.toString().trim().split(/\s+/).includes(group)
}

export async function runPendingMigrations(paths: Paths): Promise<MigrationRunResult> {
  const sudoUser = process.env.SUDO_USER
  const hadJibGroup = sudoUser ? userInGroup(sudoUser) : false
  await mkdir(paths.root, { recursive: true, mode: 0o750 })
  await mkdir(paths.stateDir, { recursive: true, mode: 0o750 })
  const appliedMigrations = await runJibMigrations(
    { db: openDb(paths.stateDir), paths },
    migrations,
  )
  const hasJibGroup = sudoUser ? userInGroup(sudoUser) : false
  return {
    appliedMigrations,
    sessionReloadRecommended: Boolean(sudoUser && !hadJibGroup && hasJibGroup),
  }
}
