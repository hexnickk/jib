import { describe, expect, test } from 'bun:test'
import { CliError, cliNormalizeError } from '@jib/cli'
import { PrepareRepoError } from './flow-errors.ts'
import { normalizeAddError } from './index.ts'
import { normalizeAddDeployError } from './runtime.ts'

describe('add command error normalization', () => {
  test('unexpected add failures keep the retry-safe rollback hint', () => {
    const normalized = cliNormalizeError(
      normalizeAddError(
        new PrepareRepoError(new Error('clone failed')),
        'blog',
        '/opt/jib/config.yml',
      ),
    )

    expect(normalized.message).toBe('clone failed')
    expect(normalized.hint).toContain('rolled back blog from /opt/jib/config.yml')
  })

  test('deploy-specific hints are preserved alongside rollback guidance', () => {
    const normalized = cliNormalizeError(
      normalizeAddDeployError(
        new CliError('deploy_failed', 'permission denied', {
          hint: 'repair /opt/jib ownership and permissions',
        }),
        'blog',
        '/opt/jib/config.yml',
      ),
    )

    expect(normalized.message).toBe('permission denied')
    expect(normalized.hint).toContain('repair /opt/jib ownership and permissions')
    expect(normalized.hint).toContain('rolled back blog from /opt/jib/config.yml')
  })
})
