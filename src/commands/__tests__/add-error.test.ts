import { describe, expect, test } from 'bun:test'
import { JibError, normalizeCliError } from '@jib/core'
import { normalizeAddError } from '../add-flow.ts'

describe('add command error normalization', () => {
  test('legacy repo-prepare mismatch hint is preserved by CLI normalization', () => {
    const normalized = normalizeCliError(
      normalizeAddError(
        new JibError('rpc.failure', 'app "blog" not found in config'),
        'blog',
        '/opt/jib/config.yml',
      ),
    )

    expect(normalized.message).toBe('app "blog" not found in config')
    expect(normalized.hint).toContain('running jib-gitsitter is older than this CLI')
  })
})
