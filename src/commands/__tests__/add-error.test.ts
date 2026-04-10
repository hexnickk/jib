import { describe, expect, test } from 'bun:test'
import { normalizeCliError } from '@jib/core'
import { normalizeAddError } from '@jib/flows'

describe('add command error normalization', () => {
  test('unexpected add failures keep the retry-safe rollback hint', () => {
    const normalized = normalizeCliError(
      normalizeAddError(new Error('clone failed'), 'blog', '/opt/jib/config.yml'),
    )

    expect(normalized.message).toBe('clone failed')
    expect(normalized.hint).toContain('rolled back blog from /opt/jib/config.yml')
  })
})
