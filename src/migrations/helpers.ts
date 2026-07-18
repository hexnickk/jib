import { chown, rename, unlink, writeFile } from 'node:fs/promises'
import { $ } from '@/libs/shell'
import { InternalError, ValidationError } from '@jib/errors'

export const GROUP = 'jib'
export const DOCKER_GROUP = 'docker'
export const SUDOERS_PATH = '/etc/sudoers.d/jib'

export const MINIMAL_CONFIG = `config_version: 3
poll_interval: 5m
modules: {}
apps: {}
`

interface VisudoCheckResult {
  exitCode: number
  stderr: { toString(): string }
}

interface SudoersDeps {
  check?: (path: string) => VisudoCheckResult
  chown?: (path: string, uid: number, gid: number) => Promise<void>
  rename?: (from: string, to: string) => Promise<void>
  unlink?: (path: string) => Promise<void>
  writeFile?: (path: string, content: string, options?: { mode?: number }) => Promise<void>
}

interface MigrationCommandResult {
  exitCode: number
  stdout: { toString(): string }
  stderr: { toString(): string }
}

interface UserGroupDeps {
  run?: (args: readonly string[]) => Promise<MigrationCommandResult> | MigrationCommandResult
}

export function buildSudoersContent(): string {
  return `# jib: allow jib group to manage jib-owned services without password
%jib ALL=(root) NOPASSWD: /usr/bin/systemctl start jib-*, \\
  /usr/bin/systemctl stop jib-*, \\
  /usr/bin/systemctl restart jib-*, \\
  /usr/bin/systemctl enable jib-*, \\
  /usr/bin/systemctl disable jib-*, \\
  /usr/bin/systemctl daemon-reload, \\
  /usr/bin/systemctl reload nginx, \\
  /usr/sbin/nginx -t
`
}

export async function writeValidatedSudoersResult(
  path: string,
  content: string,
  deps: SudoersDeps = {},
): Promise<undefined | ValidationError | InternalError> {
  const tmp = `${path}.tmp-${process.pid}`
  const write = deps.writeFile ?? writeFile
  const check =
    deps.check ??
    ((checkPath: string) => {
      const result = $.sync`visudo -cf ${checkPath}`
      return { exitCode: result.exitCode ?? 0, stderr: result.stderr }
    })
  const move = deps.rename ?? rename
  const setOwner = deps.chown ?? chown
  const remove = deps.unlink ?? unlink
  let installed = false

  try {
    await write(tmp, content, { mode: 0o440 })
  } catch (error) {
    return new InternalError(`failed to write sudoers temp file ${tmp}`, {
      cause: error instanceof Error ? error : undefined,
    })
  }

  let checkResult: VisudoCheckResult
  try {
    checkResult = check(tmp)
  } catch (error) {
    await remove(tmp).catch(() => {})
    return new ValidationError(`failed to validate sudoers file ${path}`, {
      cause: error instanceof Error ? error : undefined,
    })
  }

  if (checkResult.exitCode !== 0) {
    await remove(tmp).catch(() => {})
    const stderr = checkResult.stderr.toString().trim()
    return new ValidationError(stderr || `visudo rejected ${path}`)
  }

  try {
    await move(tmp, path)
    installed = true
    await setOwner(path, 0, 0)
    return
  } catch (error) {
    await remove(installed ? path : tmp).catch(() => {})
    return new InternalError(
      `failed to install sudoers file ${path}: ${error instanceof Error ? error.message : String(error)}`,
      {
        cause: error instanceof Error ? error : undefined,
      },
    )
  }
}

export async function writeValidatedSudoers(
  path: string,
  content: string,
  deps: SudoersDeps = {},
): Promise<InternalError | ValidationError | undefined> {
  return writeValidatedSudoersResult(path, content, deps)
}

/**
 * Ensures a system group exists. Input is the target group name; side effects
 * are `getent` and possibly `groupadd` unless a test runner is injected.
 * Returns a typed migration error instead of throwing on host command failures.
 */
export async function migrationEnsureGroupResult(
  group: string,
  deps: UserGroupDeps = {},
): Promise<InternalError | undefined> {
  const run = deps.run ?? migrationRunCommand
  try {
    const groupResult = await run(['getent', 'group', group])
    if (groupResult.exitCode === 0) {
      return undefined
    }

    const createResult = await run(['groupadd', '--system', group])
    if (createResult.exitCode !== 0) {
      return new InternalError(
        `failed to create group "${group}": ${migrationCommandDetail(createResult)}`,
      )
    }
    return undefined
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return new InternalError(`ensure group "${group}": ${message}`, { cause: error })
  }
}

/**
 * Ensures a user is listed as a member of a system group. Inputs are a login
 * name and group name; side effects are group creation, `id`, and possibly
 * `usermod` unless a test runner is injected. Returns a typed migration error.
 */
export async function migrationEnsureUserInGroupResult(
  user: string,
  group: string,
  deps: UserGroupDeps = {},
): Promise<InternalError | undefined> {
  const run = deps.run ?? migrationRunCommand
  const groupError = await migrationEnsureGroupResult(group, deps)
  if (groupError) {
    return groupError
  }

  try {
    const currentGroups = await run(['id', '-nG', user])
    if (currentGroups.exitCode !== 0) {
      return new InternalError(
        `failed to read groups for user "${user}": ${migrationCommandDetail(currentGroups)}`,
      )
    }
    if (currentGroups.stdout.toString().trim().split(/\s+/).includes(group)) {
      return undefined
    }

    const addResult = await run(['usermod', '-aG', group, user])
    if (addResult.exitCode !== 0) {
      return new InternalError(
        `failed to add user "${user}" to group "${group}": ${migrationCommandDetail(addResult)}`,
      )
    }
    return undefined
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return new InternalError(`add user "${user}" to group "${group}": ${message}`, {
      cause: error,
    })
  }
}

function migrationRunCommand(args: readonly string[]): MigrationCommandResult {
  const result = $.sync`${args}`
  return { exitCode: result.exitCode ?? 0, stdout: result.stdout, stderr: result.stderr }
}

function migrationCommandDetail(result: MigrationCommandResult): string {
  return (
    result.stderr.toString().trim() ||
    result.stdout.toString().trim() ||
    `command exited with code ${result.exitCode}`
  )
}
