import { describe, expect, test } from 'bun:test'
import { ValidateSudoersError, WriteSudoersError } from './errors.ts'
import { buildSudoersContent, writeValidatedSudoersResult } from './helpers.ts'

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
