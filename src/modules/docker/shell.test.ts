import { ValidationError } from '@jib/errors'
import { describe, expect, test } from 'vitest'
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
    expect(dockerParseExecArgs(['web'])).toBeInstanceOf(ValidationError)
  })

  test('empty returns a typed error', () => {
    expect(dockerParseExecArgs([])).toBeInstanceOf(ValidationError)
  })

  test('-- with empty before', () => {
    expect(dockerParseExecArgs(['web', '--', 'ls'])).toEqual({
      app: 'web',
      service: '',
      cmd: ['ls'],
    })
  })

  test('missing command after -- returns a typed error', () => {
    expect(dockerParseExecArgs(['web', '--'])).toBeInstanceOf(ValidationError)
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
    expect(dockerParseRunArgs([])).toBeInstanceOf(ValidationError)
  })
})
