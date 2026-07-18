import { existsSync } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { $ } from '@/libs/shell'
import { InternalError } from '@jib/errors'
import type { Paths } from '@jib/paths'
import { stateOpenDb } from '@jib/state'
import type { JibDb } from '@jib/state'
import { DOCKER_GROUP, GROUP } from './helpers.ts'
import { migrations, runJibMigrationsResult } from './index.ts'

const SESSION_RELOAD_GROUPS = [GROUP, DOCKER_GROUP]

interface GroupCheckDeps {
  run?: (args: string[]) => { exitCode: number; stdout: { toString(): string } }
}

export interface MigrationRunResult {
  appliedMigrations: string[]
  sessionReloadGroups: string[]
}

export function hasBootstrapState(paths: Paths): boolean {
  return existsSync(paths.configFile) && existsSync(join(paths.stateDir, 'jib.db'))
}

export function userInGroup(
  user: string,
  group: string = GROUP,
  deps: GroupCheckDeps = {},
): boolean {
  const run =
    deps.run ??
    ((args) => {
      const result = $.sync`${args}`
      return { exitCode: result.exitCode ?? 0, stdout: result.stdout }
    })
  try {
    const result = run(['id', '-nG', user])
    if (result.exitCode !== 0) {
      return false
    }
    return result.stdout.toString().trim().split(/\s+/).includes(group)
  } catch {
    return false
  }
}

/** Returns newly granted groups that require the sudo-invoking user to restart their session. */
export function migrationMissingUserGroups(
  user: string | undefined,
  groups: string[] = SESSION_RELOAD_GROUPS,
  deps: GroupCheckDeps = {},
): string[] {
  if (!user || user === 'root') {
    return []
  }
  return groups.filter((group) => !userInGroup(user, group, deps))
}

/** Runs all pending migrations and returns their summary or a shared internal error. */
export async function runPendingMigrationsResult(
  paths: Paths,
): Promise<MigrationRunResult | InternalError> {
  const sudoUser = process.env.SUDO_USER
  const missingGroupsBefore = migrationMissingUserGroups(sudoUser)

  try {
    await mkdir(paths.root, { recursive: true, mode: 0o750 })
    await mkdir(paths.stateDir, { recursive: true, mode: 0o750 })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return new InternalError(`failed to prepare migration directories: ${message}`, {
      cause: error,
    })
  }

  let db: JibDb
  try {
    db = stateOpenDb(paths.stateDir)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return new InternalError(`failed to open migration database: ${message}`, { cause: error })
  }

  const appliedMigrations = await runJibMigrationsResult({ db, paths }, migrations)
  if (appliedMigrations instanceof Error) {
    return appliedMigrations
  }

  const missingGroupsAfter = migrationMissingUserGroups(sudoUser)
  const sessionReloadGroups = missingGroupsBefore.filter(
    (group) => !missingGroupsAfter.includes(group),
  )
  return { appliedMigrations, sessionReloadGroups }
}

/** Runs pending migrations using the same result-style contract as the lower-level runner. */
export async function runPendingMigrations(
  paths: Paths,
): Promise<MigrationRunResult | InternalError> {
  return runPendingMigrationsResult(paths)
}
