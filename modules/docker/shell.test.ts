import { describe, expect, test } from 'bun:test'
import { parseExecArgs, parseRunArgs } from './shell.ts'

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

  test('app only → throws', () => {
    expect(() => parseExecArgs(['web'])).toThrow(/command required/)
  })

  test('empty → throws', () => {
    expect(() => parseExecArgs([])).toThrow(/missing app/)
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

  test('empty argv → throws', () => {
    expect(() => parseRunArgs([])).toThrow(/missing app/)
  })
})
