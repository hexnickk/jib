import { describe, expect, test } from 'bun:test'
import { parseExecArgs, parseRunArgs } from '../shell.ts'

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

  test('missing service → throws', () => {
    expect(() => parseRunArgs(['web'])).toThrow(/service required/)
  })
})
