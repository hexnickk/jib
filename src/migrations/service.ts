import { existsSync } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import type { Paths } from '@jib/paths'
import { stateOpenDb } from '@jib/state'
import type { JibDb } from '@jib/state'
import { type RunMigrationError, RunPendingMigrationsError, errorMessage } from './errors.ts'
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
  const run = deps.run ?? ((args) => Bun.spawnSync(args))
  const result = run(['id', '-nG', user])
  if (result.exitCode !== 0) return false
  return result.stdout.toString().trim().split(/\s+/).includes(group)
}

/**
 * Returns the groups that the sudo-invoking user still lacks. Undefined/root
 * users do not need session refresh guidance because root already has access.
 */
export function migrationMissingUserGroups(
  user: string | undefined,
  groups: string[] = SESSION_RELOAD_GROUPS,
  deps: GroupCheckDeps = {},
): string[] {
  if (!user || user === 'root') return []
  return groups.filter((group) => !userInGroup(user, group, deps))
}

export async function runPendingMigrationsResult(
  paths: Paths,
): Promise<MigrationRunResult | RunMigrationError | RunPendingMigrationsError> {
  const sudoUser = process.env.SUDO_USER
  const missingGroupsBefore = migrationMissingUserGroups(sudoUser)

  try {
    await mkdir(paths.root, { recursive: true, mode: 0o750 })
    await mkdir(paths.stateDir, { recursive: true, mode: 0o750 })
  } catch (error) {
    return new RunPendingMigrationsError(
      `failed to prepare migration directories: ${errorMessage(error)}`,
      { cause: error instanceof Error ? error : undefined },
    )
  }

  let db: JibDb
  try {
    db = stateOpenDb(paths.stateDir)
  } catch (error) {
    return new RunPendingMigrationsError(
      `failed to open migration database: ${errorMessage(error)}`,
      {
        cause: error instanceof Error ? error : undefined,
      },
    )
  }

  const appliedMigrations = await runJibMigrationsResult({ db, paths }, migrations)
  if (appliedMigrations instanceof Error) return appliedMigrations

  const missingGroupsAfter = migrationMissingUserGroups(sudoUser)
  const sessionReloadGroups = missingGroupsBefore.filter(
    (group) => !missingGroupsAfter.includes(group),
  )
  return { appliedMigrations, sessionReloadGroups }
}

export async function runPendingMigrations(paths: Paths): Promise<MigrationRunResult> {
  const result = await runPendingMigrationsResult(paths)
  if (result instanceof Error) throw result
  return result
}
