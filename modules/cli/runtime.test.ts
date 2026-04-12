import { afterEach, describe, expect, test } from 'bun:test'
import { createLogger } from '@jib/logging'
import { LogLevels } from 'consola'
import {
  CliError,
  InvalidInteractiveModeError,
  InvalidOutputModeError,
  MissingInputError,
  configureCliRuntime,
  getCliRuntime,
  normalizeCliError,
  setCliRuntime,
  stripCliRuntimeArgs,
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
  setCliRuntime({
    interactive: 'auto',
    output: 'text',
    debug: false,
    stdinTty: true,
    stdoutTty: true,
  })
})

describe('configureCliRuntime', () => {
  test('prefers explicit flags over env defaults', () => {
    process.env.JIB_INTERACTIVE = 'never'
    process.env.JIB_OUTPUT = 'json'
    const runtime = configureCliRuntime(['--interactive=always', '--output', 'text', '--debug'])
    expect(runtime).not.toBeInstanceOf(CliError)
    if (runtime instanceof CliError) throw runtime
    expect(runtime.interactive).toBe('always')
    expect(runtime.output).toBe('text')
    expect(runtime.debug).toBe(true)
    expect(getCliRuntime().debug).toBe(true)
  })

  test('respects env defaults when flags are absent', () => {
    process.env.JIB_NON_INTERACTIVE = '1'
    process.env.JIB_OUTPUT = 'json'
    const runtime = configureCliRuntime([])
    expect(runtime).not.toBeInstanceOf(CliError)
    if (runtime instanceof CliError) throw runtime
    expect(runtime.interactive).toBe('never')
    expect(runtime.output).toBe('json')
  })

  test('clears debug env cleanly when debug is disabled', () => {
    const configured = configureCliRuntime(['--debug'])
    expect(configured).not.toBeInstanceOf(CliError)
    expect(process.env.JIB_DEBUG).toBe('1')

    setCliRuntime({
      debug: false,
      interactive: 'auto',
      output: 'text',
      stdinTty: true,
      stdoutTty: true,
    })
    expect(process.env.JIB_DEBUG).toBeUndefined()
  })

  test('returns a typed error for an invalid interactive flag', () => {
    const runtime = configureCliRuntime(['--interactive=bad'])
    expect(runtime).toBeInstanceOf(InvalidInteractiveModeError)
  })

  test('returns a typed error for an invalid output env value', () => {
    process.env.JIB_OUTPUT = 'yaml'
    const runtime = configureCliRuntime([])
    expect(runtime).toBeInstanceOf(InvalidOutputModeError)
  })
})

describe('createLogger', () => {
  test('reflects runtime debug changes', () => {
    setCliRuntime({
      interactive: 'auto',
      output: 'text',
      debug: false,
      stdinTty: true,
      stdoutTty: true,
    })
    expect(createLogger('test').level).toBe(LogLevels.warn)

    setCliRuntime({
      interactive: 'auto',
      output: 'text',
      debug: true,
      stdinTty: true,
      stdoutTty: true,
    })
    expect(createLogger('test').level).toBeGreaterThan(LogLevels.warn)
  })
})

describe('stripCliRuntimeArgs', () => {
  test('removes root runtime args and keeps command args intact', () => {
    expect(
      stripCliRuntimeArgs([
        '--output=json',
        '--debug',
        'add',
        'demo',
        '--interactive',
        'never',
        '--repo',
        'owner/name',
      ]),
    ).toEqual(['add', 'demo', '--repo', 'owner/name'])
  })

  test('preserves args after -- for passthrough commands', () => {
    expect(
      stripCliRuntimeArgs([
        'exec',
        'demo',
        '--output=json',
        '--',
        'node',
        '-e',
        'process.argv',
        '--output',
        'json',
        '--debug',
      ]),
    ).toEqual(['exec', 'demo', '--', 'node', '-e', 'process.argv', '--output', 'json', '--debug'])
  })
})

describe('normalizeCliError', () => {
  test('preserves structured missing-input details', () => {
    const normalized = normalizeCliError(
      new MissingInputError('missing required input', [
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
