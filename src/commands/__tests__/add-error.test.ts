import { describe, expect, test } from 'bun:test'
import { CliError, normalizeCliError } from '@jib/core'
import { normalizeAddError } from '@jib/flows'
import { normalizeAddDeployError } from '../add-runtime.ts'

describe('add command error normalization', () => {
  test('unexpected add failures keep the retry-safe rollback hint', () => {
    const normalized = normalizeCliError(
      normalizeAddError(new Error('clone failed'), 'blog', '/opt/jib/config.yml'),
    )

    expect(normalized.message).toBe('clone failed')
    expect(normalized.hint).toContain('rolled back blog from /opt/jib/config.yml')
  })

  test('deploy-specific hints are preserved alongside rollback guidance', () => {
    const normalized = normalizeCliError(
      normalizeAddDeployError(
        new CliError('deploy_failed', 'permission denied', {
          hint: 'rerun `sudo jib init` to repair /opt/jib permissions',
        }),
        'blog',
        '/opt/jib/config.yml',
      ),
    )

    expect(normalized.message).toBe('permission denied')
    expect(normalized.hint).toContain('rerun `sudo jib init`')
    expect(normalized.hint).toContain('rolled back blog from /opt/jib/config.yml')
  })
})
