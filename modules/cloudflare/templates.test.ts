import { describe, expect, test } from 'bun:test'
import { CLOUDFLARE_SERVICE_NAME, CLOUDFLARE_UNIT_PATH, renderSystemdUnit } from './templates.ts'

describe('cloudflare templates', () => {
  test('renderSystemdUnit contains JIB_ROOT, bus requirement and bin path', () => {
    const unit = renderSystemdUnit({ jibRoot: '/var/lib/jib', binPath: '/usr/local/bin/jib' })
    expect(unit).toContain('Environment=JIB_ROOT=/var/lib/jib')
    expect(unit).toContain('Requires=jib-bus.service')
    expect(unit).toContain('After=jib-bus.service')
    expect(unit).toContain('ExecStart=/usr/local/bin/jib service start cloudflare')
    expect(unit).toContain('Description=jib cloudflare operator')
    expect(unit).toContain('[Install]')
  })

  test('unit path + service name constants are stable', () => {
    expect(CLOUDFLARE_UNIT_PATH).toBe('/etc/systemd/system/jib-cloudflare.service')
    expect(CLOUDFLARE_SERVICE_NAME).toBe('jib-cloudflare.service')
  })
})
