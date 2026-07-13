import { describe, expect, test } from 'vitest'

import { CancelledError, InternalError, JibError, NotFoundError, ValidationError } from './index'

describe('errors', () => {
  test('sets names and codes for shared error types', () => {
    const errors = [
      [new InternalError('failed'), 'InternalError', 'internal'],
      [new NotFoundError('missing'), 'NotFoundError', 'not_found'],
      [new ValidationError('invalid'), 'ValidationError', 'validation'],
      [new CancelledError('cancelled'), 'CancelledError', 'cancelled'],
    ] as const

    for (const [error, name, code] of errors) {
      expect(error).toBeInstanceOf(JibError)
      expect(error.name).toBe(name)
      expect(error.code).toBe(code)
    }
  })

  test('preserves cause metadata', () => {
    const cause = new Error('root cause')
    const error = new InternalError('failed', { cause })

    expect(error.cause).toBe(cause)
  })
})
