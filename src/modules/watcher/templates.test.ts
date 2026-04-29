import { describe, expect, test } from 'bun:test'
import { systemdUnit } from './templates.ts'

describe('watcher systemd template', () => {
  test('uses a shared umask so root-created checkout files stay group-writable', () => {
    const unit = systemdUnit({ jibRoot: '/opt/jib', binPath: '/usr/local/bin/jib' })

    expect(unit).toContain('Environment=JIB_ROOT=/opt/jib')
    expect(unit).toContain('UMask=0002')
    expect(unit).toContain('ExecStart=/usr/local/bin/jib watch')
  })
})
