import { afterEach, describe, expect, test } from 'bun:test'
import { createLogger } from '@jib/logging'
import { LogLevels } from 'consola'
import {
  InvalidInteractiveModeError,
  InvalidOutputModeError,
  cliApplyRuntimeArgv,
  cliCreateMissingInputError,
  cliNormalizeError,
  cliReadRuntime,
  cliSetRuntime,
} from './index.ts'

const envSnapshot = {
  JIB_NON_INTERACTIVE: process.env.JIB_NON_INTERACTIVE,
  JIB_INTERACTIVE: process.env.JIB_INTERACTIVE,
  JIB_OUTPUT: process.env.JIB_OUTPUT,
  JIB_DEBUG: process.env.JIB_DEBUG,
}

afterEach(() => {
  process.env.JIB_NON_INTERACTIVE = envSnapshot.JIB_NON_INTERACTIVE
  process.env.JIB_INTERACTIVE = envSnapshot.JIB_INTERACTIVE
  process.env.JIB_OUTPUT = envSnapshot.JIB_OUTPUT
  process.env.JIB_DEBUG = envSnapshot.JIB_DEBUG
  cliSetRuntime({
    interactive: 'auto',
    output: 'text',
    debug: false,
    stdinTty: true,
    stdoutTty: true,
  })
})

describe('cliApplyRuntimeArgv', () => {
  test('prefers explicit argv over env defaults', () => {
    process.env.JIB_INTERACTIVE = 'never'
    process.env.JIB_OUTPUT = 'json'
    const runtime = cliApplyRuntimeArgv({ interactive: 'always', output: 'text', debug: true })
    expect(runtime).not.toBeInstanceOf(Error)
    if (runtime instanceof Error) throw runtime
    expect(runtime.interactive).toBe('always')
    expect(runtime.output).toBe('text')
    expect(runtime.debug).toBe(true)

    const current = cliReadRuntime()
    expect(current).not.toBeInstanceOf(Error)
    if (current instanceof Error) throw current
    expect(current.debug).toBe(true)
  })

  test('respects env defaults when argv omits runtime flags', () => {
    process.env.JIB_NON_INTERACTIVE = '1'
    process.env.JIB_OUTPUT = 'json'
    const runtime = cliSetRuntime({ stdinTty: true, stdoutTty: true })
    expect(runtime).not.toBeInstanceOf(Error)
    if (runtime instanceof Error) throw runtime
    expect(runtime.interactive).toBe('never')
    expect(runtime.output).toBe('json')
  })

  test('clears debug env cleanly when debug is disabled', () => {
    const enabled = cliSetRuntime({
      interactive: 'auto',
      output: 'text',
      debug: true,
      stdinTty: true,
      stdoutTty: true,
    })
    expect(enabled).not.toBeInstanceOf(Error)
    expect(process.env.JIB_DEBUG).toBe('1')

    const disabled = cliSetRuntime({
      interactive: 'auto',
      output: 'text',
      debug: false,
      stdinTty: true,
      stdoutTty: true,
    })
    expect(disabled).not.toBeInstanceOf(Error)
    expect(process.env.JIB_DEBUG).toBeUndefined()
  })

  test('returns a typed error for an invalid interactive mode', () => {
    expect(cliApplyRuntimeArgv({ interactive: 'bad' })).toBeInstanceOf(InvalidInteractiveModeError)
  })

  test('returns a typed error for an invalid output env value', () => {
    process.env.JIB_OUTPUT = 'yaml'
    expect(cliSetRuntime({ stdinTty: true, stdoutTty: true })).toBeInstanceOf(
      InvalidOutputModeError,
    )
  })
})

describe('createLogger', () => {
  test('reflects runtime debug changes', () => {
    cliSetRuntime({
      interactive: 'auto',
      output: 'text',
      debug: false,
      stdinTty: true,
      stdoutTty: true,
    })
    expect(createLogger('test').level).toBe(LogLevels.warn)

    cliSetRuntime({
      interactive: 'auto',
      output: 'text',
      debug: true,
      stdinTty: true,
      stdoutTty: true,
    })
    expect(createLogger('test').level).toBeGreaterThan(LogLevels.warn)
  })
})

describe('cliNormalizeError', () => {
  test('preserves structured missing-input details', () => {
    const normalized = cliNormalizeError(
      cliCreateMissingInputError('missing required input', [
        { field: 'repo', message: 'provide --repo or rerun interactively' },
      ]),
    )
    expect(normalized.code).toBe('missing_input')
    expect(normalized.issues).toEqual([
      { field: 'repo', message: 'provide --repo or rerun interactively' },
    ])
    expect(normalized.exitCode).toBe(1)
  })
})
