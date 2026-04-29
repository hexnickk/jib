import { describe, expect, test } from 'bun:test'
import { AddUserToGroupError, ValidateSudoersError, WriteSudoersError } from './errors.ts'
import {
  buildSudoersContent,
  migrationEnsureGroupResult,
  migrationEnsureUserInGroupResult,
  writeValidatedSudoersResult,
} from './helpers.ts'

function commandResult(exitCode: number, stdout = '', stderr = '') {
  return {
    exitCode,
    stderr: { toString: () => stderr },
    stdout: { toString: () => stdout },
  }
}

describe('migrationEnsureGroupResult', () => {
  test('creates a missing system group', async () => {
    const calls: string[] = []
    const result = await migrationEnsureGroupResult('docker', {
      run: (args) => {
        const call = args.join(' ')
        calls.push(call)
        if (call === 'getent group docker') return commandResult(2)
        if (call === 'groupadd --system docker') return commandResult(0)
        return commandResult(1, '', `unexpected ${call}`)
      },
    })

    expect(result).toBeUndefined()
    expect(calls).toEqual(['getent group docker', 'groupadd --system docker'])
  })

  test('skips creation when the group already exists', async () => {
    const calls: string[] = []
    const result = await migrationEnsureGroupResult('docker', {
      run: (args) => {
        calls.push(args.join(' '))
        return commandResult(0, 'docker:x:999:demo\n')
      },
    })

    expect(result).toBeUndefined()
    expect(calls).toEqual(['getent group docker'])
  })
})

describe('migrationEnsureUserInGroupResult', () => {
  test('creates a missing group and adds the user', async () => {
    const calls: string[] = []
    const result = await migrationEnsureUserInGroupResult('demo', 'docker', {
      run: (args) => {
        const call = args.join(' ')
        calls.push(call)
        if (call === 'getent group docker') return commandResult(2)
        if (call === 'groupadd --system docker') return commandResult(0)
        if (call === 'id -nG demo') return commandResult(0, 'wheel jib\n')
        if (call === 'usermod -aG docker demo') return commandResult(0)
        return commandResult(1, '', `unexpected ${call}`)
      },
    })

    expect(result).toBeUndefined()
    expect(calls).toEqual([
      'getent group docker',
      'groupadd --system docker',
      'id -nG demo',
      'usermod -aG docker demo',
    ])
  })

  test('skips usermod when the user is already in the group', async () => {
    const calls: string[] = []
    const result = await migrationEnsureUserInGroupResult('demo', 'docker', {
      run: (args) => {
        const call = args.join(' ')
        calls.push(call)
        if (call === 'getent group docker') return commandResult(0)
        if (call === 'id -nG demo') return commandResult(0, 'wheel docker\n')
        return commandResult(1, '', `unexpected ${call}`)
      },
    })

    expect(result).toBeUndefined()
    expect(calls).toEqual(['getent group docker', 'id -nG demo'])
  })

  test('returns a typed error when membership cannot be changed', async () => {
    const result = await migrationEnsureUserInGroupResult('demo', 'docker', {
      run: (args) => {
        const call = args.join(' ')
        if (call === 'getent group docker') return commandResult(0)
        if (call === 'id -nG demo') return commandResult(0, 'wheel jib\n')
        if (call === 'usermod -aG docker demo') return commandResult(6, '', 'no such user')
        return commandResult(1, '', `unexpected ${call}`)
      },
    })

    expect(result).toBeInstanceOf(AddUserToGroupError)
    expect(result?.message).toContain('failed to add user "demo" to group "docker"')
  })
})

describe('buildSudoersContent', () => {
  test('includes nginx validation and reload privileges', () => {
    const content = buildSudoersContent()
    expect(content).toContain('/usr/bin/systemctl reload nginx')
    expect(content).toContain('/usr/sbin/nginx -t')
  })

  test('returns typed validation failure when visudo rejects content', async () => {
    const result = await writeValidatedSudoersResult('/etc/sudoers.d/jib', 'bad', {
      check: () => ({ exitCode: 1, stderr: { toString: () => 'syntax error' } }),
      unlink: async () => {},
      writeFile: async () => {},
    })
    expect(result).toBeInstanceOf(ValidateSudoersError)
  })

  test('returns typed write failure when install step fails', async () => {
    const result = await writeValidatedSudoersResult('/etc/sudoers.d/jib', 'ok', {
      check: () => ({ exitCode: 0, stderr: { toString: () => '' } }),
      chown: async () => {
        throw new Error('denied')
      },
      rename: async () => {},
      unlink: async () => {},
      writeFile: async () => {},
    })
    expect(result).toBeInstanceOf(WriteSudoersError)
  })

  test('removes installed target when chown fails after rename', async () => {
    const unlinked: string[] = []
    const result = await writeValidatedSudoersResult('/etc/sudoers.d/jib', 'ok', {
      check: () => ({ exitCode: 0, stderr: { toString: () => '' } }),
      chown: async () => {
        throw new Error('denied')
      },
      rename: async () => {},
      unlink: async (path) => {
        unlinked.push(path)
      },
      writeFile: async () => {},
    })
    expect(result).toBeInstanceOf(WriteSudoersError)
    expect(unlinked).toEqual(['/etc/sudoers.d/jib'])
  })
})
