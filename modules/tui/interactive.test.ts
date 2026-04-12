import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { configureCliRuntime } from '@jib/cli'
import { ValidationError } from '@jib/errors'
import { TuiNotInteractiveError } from './errors.ts'
import { assertInteractive, assertInteractiveResult, isInteractive } from './interactive.ts'

// `isTTY` is a writable boolean on the real streams; the Node types mark it
// optional-readonly so we narrow to a mutable shape for test-only overrides.
const stdin = process.stdin as { isTTY: boolean | undefined }
const stdout = process.stdout as { isTTY: boolean | undefined }

describe('isInteractive', () => {
  const envPrev = process.env.JIB_NON_INTERACTIVE
  const stdinPrev = stdin.isTTY
  const stdoutPrev = stdout.isTTY

  beforeEach(() => {
    Reflect.deleteProperty(process.env, 'JIB_NON_INTERACTIVE')
  })
  afterEach(() => {
    if (envPrev === undefined) Reflect.deleteProperty(process.env, 'JIB_NON_INTERACTIVE')
    else process.env.JIB_NON_INTERACTIVE = envPrev
    stdin.isTTY = stdinPrev
    stdout.isTTY = stdoutPrev
  })

  test('false when JIB_NON_INTERACTIVE set', () => {
    process.env.JIB_NON_INTERACTIVE = '1'
    stdin.isTTY = true
    stdout.isTTY = true
    configureCliRuntime([])
    expect(isInteractive()).toBe(false)
  })

  test('false when stdin not a TTY', () => {
    stdin.isTTY = false
    stdout.isTTY = true
    configureCliRuntime([])
    expect(isInteractive()).toBe(false)
  })

  test('true when both TTYs and env unset', () => {
    stdin.isTTY = true
    stdout.isTTY = true
    configureCliRuntime([])
    expect(isInteractive()).toBe(true)
  })

  test('assertInteractiveResult returns a typed error in non-interactive mode', () => {
    process.env.JIB_NON_INTERACTIVE = '1'
    configureCliRuntime([])

    const error = assertInteractiveResult()

    expect(error).toBeInstanceOf(TuiNotInteractiveError)
    expect(error).toBeInstanceOf(ValidationError)
    expect(error?.message).toBe('interactive prompts are disabled by --interactive=never')
  })

  test('assertInteractive throws TuiNotInteractiveError in non-interactive mode', () => {
    process.env.JIB_NON_INTERACTIVE = '1'
    configureCliRuntime([])
    expect(() => assertInteractive()).toThrow(TuiNotInteractiveError)
  })
})
