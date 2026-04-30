import { describe, expect, test } from 'bun:test'
import type { CliRuntime } from '@jib/cli'
import { ValidationError } from '@jib/errors'
import { TuiNotInteractiveError } from './errors.ts'
import { tuiAssertInteractiveResult, tuiIsInteractive } from './interactive.ts'

/** Builds an explicit CLI runtime so TUI tests do not mutate process globals. */
function runtime(overrides: Partial<CliRuntime> = {}): CliRuntime {
  return {
    interactive: 'auto',
    debug: false,
    stdinTty: true,
    stdoutTty: true,
    ...overrides,
  }
}

describe('isInteractive', () => {
  test('false when runtime disables prompts', () => {
    expect(tuiIsInteractive(runtime({ interactive: 'never' }))).toBe(false)
  })

  test('false when stdin not a TTY', () => {
    expect(tuiIsInteractive(runtime({ stdinTty: false }))).toBe(false)
  })

  test('true when both TTYs and prompts allowed', () => {
    expect(tuiIsInteractive(runtime())).toBe(true)
  })

  test('assertInteractiveResult returns a typed error in non-interactive mode', () => {
    const error = tuiAssertInteractiveResult(runtime({ interactive: 'never' }))

    expect(error).toBeInstanceOf(TuiNotInteractiveError)
    expect(error).toBeInstanceOf(ValidationError)
    expect(error?.message).toBe('interactive prompts are disabled by --interactive=never')
  })
})
