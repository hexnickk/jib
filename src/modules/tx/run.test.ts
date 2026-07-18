import { CancelledError, InternalError } from '@jib/errors'
import { describe, expect, test } from 'vitest'
import { type Step, txRunSteps } from './run.ts'

describe('txRunSteps', () => {
  test('runs steps in order without rollback on success', async () => {
    const calls: string[] = []
    const steps: Step<object, string, InternalError>[] = [
      {
        name: 'one',
        async up() {
          calls.push('up:one')
          return 'a'
        },
        async down() {
          calls.push('down:one')
          return undefined
        },
      },
      {
        name: 'two',
        async up() {
          calls.push('up:two')
          return 'b'
        },
      },
    ]

    const result = await txRunSteps({}, steps, { cancelled: false }, () => new CancelledError(''))

    expect(result).toBeUndefined()
    expect(calls).toEqual(['up:one', 'up:two'])
  })

  test('rolls back completed steps in reverse order after a failure', async () => {
    const calls: string[] = []
    const steps: Step<object, string, InternalError>[] = [
      {
        name: 'one',
        async up() {
          calls.push('up:one')
          return 'a'
        },
        async down(_ctx, state) {
          calls.push(`down:one:${state}`)
          return undefined
        },
      },
      {
        name: 'two',
        async up() {
          calls.push('up:two')
          return 'b'
        },
        async down(_ctx, state) {
          calls.push(`down:two:${state}`)
          return undefined
        },
      },
      {
        name: 'three',
        async up() {
          calls.push('up:three')
          return new InternalError('boom')
        },
      },
    ]

    const result = await txRunSteps({}, steps, { cancelled: false }, () => new CancelledError(''))

    expect(result).toBeInstanceOf(InternalError)
    expect(result?.message).toBe('boom')
    expect(calls).toEqual(['up:one', 'up:two', 'up:three', 'down:two:b', 'down:one:a'])
  })

  test('returns cancellation and rolls back completed steps when cancelled mid-flow', async () => {
    const calls: string[] = []
    const signal = { cancelled: false }
    const steps: Step<object, string, InternalError>[] = [
      {
        name: 'one',
        async up() {
          calls.push('up:one')
          signal.cancelled = true
          return 'a'
        },
        async down() {
          calls.push('down:one')
          return undefined
        },
      },
      {
        name: 'two',
        async up() {
          calls.push('up:two')
          return 'b'
        },
      },
    ]

    const result = await txRunSteps({}, steps, signal, () => new CancelledError('cancelled'))

    expect(result).toBeInstanceOf(CancelledError)
    expect(calls).toEqual(['up:one', 'down:one'])
  })

  test('warns and keeps rolling back when a rollback step fails', async () => {
    const warnings: string[] = []
    const steps: Step<object, string, InternalError>[] = [
      {
        name: 'one',
        async up() {
          return 'a'
        },
        async down() {
          return new InternalError('down one failed')
        },
      },
      {
        name: 'two',
        async up() {
          return 'b'
        },
        async down() {
          throw new Error('down two exploded')
        },
      },
      {
        name: 'three',
        async up() {
          return new InternalError('boom')
        },
      },
    ]

    const result = await txRunSteps(
      {},
      steps,
      { cancelled: false },
      () => new CancelledError(''),
      (message) => warnings.push(message),
    )

    expect(result).toBeInstanceOf(InternalError)
    expect(warnings).toEqual(['two rollback: down two exploded', 'one rollback: down one failed'])
  })

  test('warns for an already-typed rollback failure', async () => {
    const warnings: string[] = []
    const steps: Step<object, string, InternalError>[] = [
      {
        name: 'one',
        async up() {
          return 'a'
        },
        async down() {
          return new InternalError('already wrapped')
        },
      },
      {
        name: 'two',
        async up() {
          return new InternalError('boom')
        },
      },
    ]

    await txRunSteps(
      {},
      steps,
      { cancelled: false },
      () => new CancelledError(''),
      (message) => warnings.push(message),
    )

    expect(warnings).toEqual(['one rollback: already wrapped'])
  })
})
