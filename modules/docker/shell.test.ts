import { describe, expect, test } from 'bun:test'
import {
  ExecArgsMissingAppError,
  ExecArgsMissingCommandError,
  RunArgsMissingAppError,
} from './errors.ts'
import { parseExecArgs, parseExecArgsResult, parseRunArgs, parseRunArgsResult } from './shell.ts'

describe('parseExecArgs', () => {
  test('app + service + -- + cmd', () => {
    expect(parseExecArgs(['web', 'api', '--', 'sh', '-c', 'ls'])).toEqual({
      app: 'web',
      service: 'api',
      cmd: ['sh', '-c', 'ls'],
    })
  })

  test('app + cmd without --', () => {
    expect(parseExecArgs(['web', 'psql'])).toEqual({ app: 'web', service: 'psql', cmd: [] })
  })

  test('app only → result helper returns typed error', () => {
    expect(parseExecArgsResult(['web'])).toBeInstanceOf(ExecArgsMissingCommandError)
  })

  test('empty → result helper returns typed error', () => {
    expect(parseExecArgsResult([])).toBeInstanceOf(ExecArgsMissingAppError)
  })

  test('-- with empty before', () => {
    expect(parseExecArgs(['web', '--', 'ls'])).toEqual({ app: 'web', service: '', cmd: ['ls'] })
  })
})

describe('parseRunArgs', () => {
  test('app + service + -- + cmd', () => {
    expect(parseRunArgs(['web', 'api', '--', 'migrate'])).toEqual({
      app: 'web',
      service: 'api',
      cmd: ['migrate'],
    })
  })

  test('app + service (no cmd)', () => {
    expect(parseRunArgs(['web', 'api'])).toEqual({ app: 'web', service: 'api', cmd: [] })
  })

  test('app only → service defaults to empty (resolved at runtime)', () => {
    expect(parseRunArgs(['web'])).toEqual({ app: 'web', service: '', cmd: [] })
  })

  test('app + -- + cmd (service defaults to empty)', () => {
    expect(parseRunArgs(['web', '--', 'ls', '/'])).toEqual({
      app: 'web',
      service: '',
      cmd: ['ls', '/'],
    })
  })

  test('empty argv → result helper returns typed error', () => {
    expect(parseRunArgsResult([])).toBeInstanceOf(RunArgsMissingAppError)
  })

  test('throwing wrappers still preserve current command-call behavior', () => {
    expect(() => parseExecArgs([])).toThrow(/missing app/)
    expect(() => parseRunArgs([])).toThrow(/missing app/)
  })
})
