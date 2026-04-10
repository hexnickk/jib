import { describe, expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { getPaths } from '@jib/core'
import { repairManagedTreePermissions } from './permissions.ts'

describe('repairManagedTreePermissions', () => {
  test('repairs the managed tree and refreshes sudo user membership', async () => {
    const root = await mkdtemp(join(tmpdir(), 'jib-init-perms-'))
    const paths = getPaths(root)
    const calls: string[] = []
    try {
      await Bun.write(paths.configFile, 'config_version: 3\n')
      await repairManagedTreePermissions(paths, {
        runCommand: async (command, okExitCodes) => {
          calls.push(`${command.join(' ')} :: ${okExitCodes?.join(',') ?? '0'}`)
        },
        sudoUser: 'hexnickk',
      })
    } finally {
      await rm(root, { recursive: true, force: true })
    }

    expect(calls).toEqual([
      'groupadd --system jib :: 0,9',
      `chown -R root:jib ${root} :: 0`,
      `chmod -R g+rwXs ${root} :: 0`,
      `chmod 640 ${paths.configFile} :: 0`,
      'usermod -aG jib hexnickk :: 0',
    ])
  })

  test('skips config chmod and usermod when neither applies', async () => {
    const root = await mkdtemp(join(tmpdir(), 'jib-init-perms-'))
    const paths = getPaths(root)
    const calls: string[] = []
    try {
      await repairManagedTreePermissions(paths, {
        runCommand: async (command) => {
          calls.push(command.join(' '))
        },
      })
    } finally {
      await rm(root, { recursive: true, force: true })
    }

    expect(calls).toEqual([
      'groupadd --system jib',
      `chown -R root:jib ${root}`,
      `chmod -R g+rwXs ${root}`,
    ])
  })
})
