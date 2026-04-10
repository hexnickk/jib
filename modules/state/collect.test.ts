import { describe, expect, test } from 'bun:test'
import { managedServiceNames } from './collect.ts'

describe('managedServiceNames', () => {
  test('always includes the watcher service', () => {
    expect(managedServiceNames(false)).toEqual(['jib-watcher'])
  })

  test('includes cloudflared only when the module is enabled', () => {
    expect(managedServiceNames(true)).toEqual(['jib-watcher', 'jib-cloudflared'])
  })
})
