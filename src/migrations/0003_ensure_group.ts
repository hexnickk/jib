import { $ } from '@/libs/shell'
import { InternalError } from '@jib/errors'
import { GROUP, migrationEnsureGroupResult, migrationEnsureUserInGroupResult } from './helpers.ts'
import type { JibMigration } from './types.ts'

interface PermissionRepairResult {
  exitCode: number | null
  stdout: { toString(): string }
  stderr: { toString(): string }
}

export const m0003_ensure_group: JibMigration = {
  id: '0003_ensure_group',
  description: 'Create jib group, set ownership, add invoking user',
  async up(ctx) {
    const groupError = await migrationEnsureGroupResult(GROUP)
    if (groupError) {
      return groupError
    }

    const repairs: [string, readonly string[]][] = [
      ['own managed tree', ['chown', '-R', `root:${GROUP}`, ctx.paths.root]],
      ['allow shared group access', ['chmod', '-R', 'g+rwX', ctx.paths.root]],
      [
        'keep managed directories setgid',
        ['find', ctx.paths.root, '-type', 'd', '-exec', 'chmod', 'g+s', '{}', '+'],
      ],
      ['restrict config file', ['chmod', '640', ctx.paths.configFile]],
    ]
    for (const [label, args] of repairs) {
      const repairError = runPermissionRepair(label, args)
      if (repairError) {
        return repairError
      }
    }

    const sudoUser = process.env.SUDO_USER
    if (sudoUser && sudoUser !== 'root') {
      const userError = await migrationEnsureUserInGroupResult(sudoUser, GROUP)
      if (userError) {
        return userError
      }
    }
    return undefined
  },
}

/** Runs one migration permission repair command and returns a typed failure when it exits non-zero. */
function runPermissionRepair(label: string, args: readonly string[]): InternalError | undefined {
  try {
    const result = $.sync`${args}`
    if ((result.exitCode ?? 0) === 0) {
      return undefined
    }
    return new InternalError(`${label}: ${migrationCommandDetail(result)}`)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return new InternalError(`${label}: ${message}`, { cause: error })
  }
}

/** Extracts useful diagnostics from a failed permission repair command. */
function migrationCommandDetail(result: PermissionRepairResult): string {
  return (
    result.stderr.toString().trim() ||
    result.stdout.toString().trim() ||
    `command exited with code ${result.exitCode}`
  )
}
