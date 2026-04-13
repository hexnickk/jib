import { describe, expect, test } from 'bun:test'

import { JibError, ValidationError } from './index'

class DomainError extends JibError {
  constructor(message: string, options?: ErrorOptions) {
    super('domain', message, options)
  }
}

describe('errors', () => {
  test('preserves subclass names without manual assignment', () => {
    expect(new DomainError('boom').name).toBe('DomainError')
    expect(new ValidationError('invalid').name).toBe('ValidationError')
  })

  test('keeps code and cause metadata', () => {
    const cause = new Error('root cause')
    const error = new ValidationError('invalid', { cause })

    expect(error).toBeInstanceOf(JibError)
    expect(error.code).toBe('validation')
    expect(error.cause).toBe(cause)
  })
})
