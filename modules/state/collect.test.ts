import { describe, expect, test } from 'bun:test'
import { managedServiceNames, normalizeUnitStatus } from './collect.ts'

describe('managedServiceNames', () => {
  test('always includes the watcher service', () => {
    expect(managedServiceNames(false)).toEqual(['jib-watcher'])
  })

  test('includes cloudflared only when the module is enabled', () => {
    expect(managedServiceNames(true)).toEqual(['jib-watcher', 'jib-cloudflared'])
  })
})

describe('normalizeUnitStatus', () => {
  test('preserves one-word systemctl states', () => {
    expect(normalizeUnitStatus('active\n', 0)).toBe('active')
    expect(normalizeUnitStatus('failed\n', 3)).toBe('failed')
  })

  test('maps empty failed output to unavailable', () => {
    expect(normalizeUnitStatus('', 1)).toBe('unavailable')
  })

  test('maps verbose diagnostics to unavailable', () => {
    expect(
      normalizeUnitStatus(
        '"systemd" is not running in this container due to its overhead.\nservice --status-all\n',
        1,
      ),
    ).toBe('unavailable')
  })
})
