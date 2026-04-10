import { describe, expect, test } from 'bun:test'
import { renderSystemdUnit } from './templates.ts'

describe('nginx templates', () => {
  test('renderSystemdUnit contains JIB_ROOT, bus requirement and bin path', () => {
    const unit = renderSystemdUnit({
      jibRoot: '/var/lib/jib',
      binPath: '/usr/local/bin/jib-daemon',
    })
    expect(unit).toContain('Environment=JIB_ROOT=/var/lib/jib')
    expect(unit).toContain('Requires=jib-bus.service')
    expect(unit).toContain('After=jib-bus.service')
    expect(unit).toContain('ExecStart=/usr/local/bin/jib-daemon start nginx')
    expect(unit).toContain('[Install]')
  })
})
