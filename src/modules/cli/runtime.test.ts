import { loggingCreateLogger } from '@jib/logging'
import { LogLevels } from 'consola'
import { afterEach, describe, expect, test } from 'vitest'
import {
  CliError,
  cliCreateMissingInputError,
  cliNormalizeError,
  cliReadInteractiveMode,
  cliReadRuntime,
  cliSetRuntime,
} from './index.ts'

const envSnapshot = {
  JIB_NON_INTERACTIVE: process.env.JIB_NON_INTERACTIVE,
  JIB_INTERACTIVE: process.env.JIB_INTERACTIVE,
  JIB_DEBUG: process.env.JIB_DEBUG,
}

/** Restores one environment variable to its test-suite starting value. */
function restoreEnv(name: keyof typeof envSnapshot): void {
  const value = envSnapshot[name]
  if (value === undefined) {
    Reflect.deleteProperty(process.env, name)
  } else {
    process.env[name] = value
  }
}

afterEach(() => {
  restoreEnv('JIB_NON_INTERACTIVE')
  restoreEnv('JIB_INTERACTIVE')
  cliSetRuntime({
    interactive: 'auto',
    debug: false,
    stdinTty: true,
    stdoutTty: true,
  })
  restoreEnv('JIB_DEBUG')
})

describe('cli runtime', () => {
  test('prefers explicit runtime overrides over env defaults', () => {
    process.env.JIB_INTERACTIVE = 'never'
    const runtime = cliSetRuntime({
      interactive: 'always',
      debug: true,
      stdinTty: true,
      stdoutTty: true,
    })
    expect(runtime).not.toBeInstanceOf(Error)
    if (runtime instanceof Error) {
      throw runtime
    }
    expect(runtime.interactive).toBe('always')
    expect(runtime.debug).toBe(true)

    const current = cliReadRuntime()
    expect(current).not.toBeInstanceOf(Error)
    if (current instanceof Error) {
      throw current
    }
    expect(current.debug).toBe(true)
  })

  test('respects env defaults when overrides omit runtime flags', () => {
    process.env.JIB_NON_INTERACTIVE = '1'
    const runtime = cliSetRuntime({ stdinTty: true, stdoutTty: true })
    expect(runtime).not.toBeInstanceOf(Error)
    if (runtime instanceof Error) {
      throw runtime
    }
    expect(runtime.interactive).toBe('never')
  })

  test('clears debug env cleanly when debug is disabled', () => {
    const enabled = cliSetRuntime({
      interactive: 'auto',
      debug: true,
      stdinTty: true,
      stdoutTty: true,
    })
    expect(enabled).not.toBeInstanceOf(Error)
    expect(process.env.JIB_DEBUG).toBe('1')

    const disabled = cliSetRuntime({
      interactive: 'auto',
      debug: false,
      stdinTty: true,
      stdoutTty: true,
    })
    expect(disabled).not.toBeInstanceOf(Error)
    expect(process.env.JIB_DEBUG).toBeUndefined()
  })

  test('returns a typed error for an invalid interactive mode', () => {
    expect(cliReadInteractiveMode('bad')).toBeInstanceOf(CliError)
  })

  test('returns a typed error for an invalid interactive env value', () => {
    process.env.JIB_INTERACTIVE = 'bad'
    expect(cliSetRuntime({ stdinTty: true, stdoutTty: true })).toBeInstanceOf(CliError)
  })
})

describe('loggingCreateLogger', () => {
  test('reflects runtime debug changes', () => {
    cliSetRuntime({
      interactive: 'auto',
      debug: false,
      stdinTty: true,
      stdoutTty: true,
    })
    expect(loggingCreateLogger('test').level).toBe(LogLevels.warn)

    cliSetRuntime({
      interactive: 'auto',
      debug: true,
      stdinTty: true,
      stdoutTty: true,
    })
    expect(loggingCreateLogger('test').level).toBeGreaterThan(LogLevels.warn)
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
