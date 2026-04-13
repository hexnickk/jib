import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { cliSetRuntime } from '@jib/cli'
import { ValidationError } from '@jib/errors'
import { TuiNotInteractiveError } from './errors.ts'
import {
  tuiAssertInteractive,
  tuiAssertInteractiveResult,
  tuiIsInteractive,
} from './interactive.ts'

const stdin = process.stdin as { isTTY: boolean | undefined }
const stdout = process.stdout as { isTTY: boolean | undefined }

function setTestRuntime() {
  const runtime = cliSetRuntime({
    ...(stdin.isTTY !== undefined ? { stdinTty: stdin.isTTY } : {}),
    ...(stdout.isTTY !== undefined ? { stdoutTty: stdout.isTTY } : {}),
  })
  if (runtime instanceof Error) throw runtime
}

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
    setTestRuntime()
  })

  test('false when JIB_NON_INTERACTIVE set', () => {
    process.env.JIB_NON_INTERACTIVE = '1'
    stdin.isTTY = true
    stdout.isTTY = true
    setTestRuntime()
    expect(tuiIsInteractive()).toBe(false)
  })

  test('false when stdin not a TTY', () => {
    stdin.isTTY = false
    stdout.isTTY = true
    setTestRuntime()
    expect(tuiIsInteractive()).toBe(false)
  })

  test('true when both TTYs and env unset', () => {
    stdin.isTTY = true
    stdout.isTTY = true
    setTestRuntime()
    expect(tuiIsInteractive()).toBe(true)
  })

  test('assertInteractiveResult returns a typed error in non-interactive mode', () => {
    process.env.JIB_NON_INTERACTIVE = '1'
    stdin.isTTY = true
    stdout.isTTY = true
    setTestRuntime()

    const error = tuiAssertInteractiveResult()

    expect(error).toBeInstanceOf(TuiNotInteractiveError)
    expect(error).toBeInstanceOf(ValidationError)
    expect(error?.message).toBe('interactive prompts are disabled by --interactive=never')
  })

  test('assertInteractive throws TuiNotInteractiveError in non-interactive mode', () => {
    process.env.JIB_NON_INTERACTIVE = '1'
    stdin.isTTY = true
    stdout.isTTY = true
    setTestRuntime()
    expect(() => tuiAssertInteractive()).toThrow(TuiNotInteractiveError)
  })
})
