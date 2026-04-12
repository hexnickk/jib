import { describe, expect, test } from 'bun:test'
import { type Step, runSteps } from './run.ts'

class FlowError extends Error {}
class CancelledError extends Error {}

describe('runSteps', () => {
  test('runs steps in order without rollback on success', async () => {
    const calls: string[] = []
    const steps: Step<object, string, FlowError>[] = [
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

    const result = await runSteps({}, steps, { cancelled: false }, () => new CancelledError())

    expect(result).toBeUndefined()
    expect(calls).toEqual(['up:one', 'up:two'])
  })

  test('rolls back completed steps in reverse order after a failure', async () => {
    const calls: string[] = []
    const steps: Step<object, string, FlowError>[] = [
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
          return new FlowError('boom')
        },
      },
    ]

    const result = await runSteps({}, steps, { cancelled: false }, () => new CancelledError())

    expect(result).toBeInstanceOf(FlowError)
    expect((result as Error).message).toBe('boom')
    expect(calls).toEqual(['up:one', 'up:two', 'up:three', 'down:two:b', 'down:one:a'])
  })

  test('returns cancellation and rolls back completed steps when cancelled mid-flow', async () => {
    const calls: string[] = []
    const signal = {
      cancelled: false,
    }
    const steps: Step<object, string, FlowError>[] = [
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

    const result = await runSteps({}, steps, signal, () => new CancelledError('cancelled'))

    expect(result).toBeInstanceOf(CancelledError)
    expect(calls).toEqual(['up:one', 'down:one'])
  })

  test('warns and keeps rolling back when a rollback step fails', async () => {
    const warnings: string[] = []
    const steps: Step<object, string, FlowError>[] = [
      {
        name: 'one',
        async up() {
          return 'a'
        },
        async down() {
          return new Error('down one failed')
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
          return new FlowError('boom')
        },
      },
    ]

    const result = await runSteps(
      {},
      steps,
      { cancelled: false },
      () => new CancelledError(),
      (m) => warnings.push(m),
    )

    expect(result).toBeInstanceOf(FlowError)
    expect(warnings).toEqual(['two rollback: down two exploded', 'one rollback: down one failed'])
  })
})
