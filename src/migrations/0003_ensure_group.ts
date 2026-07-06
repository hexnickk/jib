import { $ } from '@/libs/shell'
import { RepairPermissionsError } from './errors.ts'
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
  up: async (ctx) => {
    const groupError = await migrationEnsureGroupResult(GROUP)
    if (groupError) throw groupError

    runPermissionRepair('own managed tree', ['chown', '-R', `root:${GROUP}`, ctx.paths.root])
    runPermissionRepair('allow shared group access', ['chmod', '-R', 'g+rwX', ctx.paths.root])
    runPermissionRepair('keep managed directories setgid', [
      'find',
      ctx.paths.root,
      '-type',
      'd',
      '-exec',
      'chmod',
      'g+s',
      '{}',
      '+',
    ])
    runPermissionRepair('restrict config file', ['chmod', '640', ctx.paths.configFile])

    const sudoUser = process.env.SUDO_USER
    if (sudoUser && sudoUser !== 'root') {
      const userError = await migrationEnsureUserInGroupResult(sudoUser, GROUP)
      if (userError) throw userError
    }
  },
}

/** Runs one migration permission repair command and throws a typed error on failure. */
function runPermissionRepair(label: string, args: readonly string[]): void {
  const result = $.sync`${args}`
  if ((result.exitCode ?? 0) === 0) return
  throw new RepairPermissionsError(`${label}: ${migrationCommandDetail(result)}`)
}

function migrationCommandDetail(result: PermissionRepairResult): string {
  return (
    result.stderr.toString().trim() ||
    result.stdout.toString().trim() ||
    `command exited with code ${result.exitCode}`
  )
}
