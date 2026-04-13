import { describe, expect, test } from 'bun:test'
import {
  ExecArgsMissingAppError,
  ExecArgsMissingCommandError,
  RunArgsMissingAppError,
} from './errors.ts'
import { dockerParseExecArgs, dockerParseRunArgs } from './shell.ts'

describe('dockerParseExecArgs', () => {
  test('app + service + -- + cmd', () => {
    expect(dockerParseExecArgs(['web', 'api', '--', 'sh', '-c', 'ls'])).toEqual({
      app: 'web',
      service: 'api',
      cmd: ['sh', '-c', 'ls'],
    })
  })

  test('app + cmd without --', () => {
    expect(dockerParseExecArgs(['web', 'psql'])).toEqual({ app: 'web', service: 'psql', cmd: [] })
  })

  test('app only returns a typed error', () => {
    expect(dockerParseExecArgs(['web'])).toBeInstanceOf(ExecArgsMissingCommandError)
  })

  test('empty returns a typed error', () => {
    expect(dockerParseExecArgs([])).toBeInstanceOf(ExecArgsMissingAppError)
  })

  test('-- with empty before', () => {
    expect(dockerParseExecArgs(['web', '--', 'ls'])).toEqual({
      app: 'web',
      service: '',
      cmd: ['ls'],
    })
  })

  test('missing command after -- returns a typed error', () => {
    expect(dockerParseExecArgs(['web', '--'])).toBeInstanceOf(ExecArgsMissingCommandError)
  })
})

describe('dockerParseRunArgs', () => {
  test('app + service + -- + cmd', () => {
    expect(dockerParseRunArgs(['web', 'api', '--', 'migrate'])).toEqual({
      app: 'web',
      service: 'api',
      cmd: ['migrate'],
    })
  })

  test('app + service (no cmd)', () => {
    expect(dockerParseRunArgs(['web', 'api'])).toEqual({ app: 'web', service: 'api', cmd: [] })
  })

  test('app only → service defaults to empty (resolved at runtime)', () => {
    expect(dockerParseRunArgs(['web'])).toEqual({ app: 'web', service: '', cmd: [] })
  })

  test('app + -- + cmd (service defaults to empty)', () => {
    expect(dockerParseRunArgs(['web', '--', 'ls', '/'])).toEqual({
      app: 'web',
      service: '',
      cmd: ['ls', '/'],
    })
  })

  test('empty argv returns a typed error', () => {
    expect(dockerParseRunArgs([])).toBeInstanceOf(RunArgsMissingAppError)
  })
})
