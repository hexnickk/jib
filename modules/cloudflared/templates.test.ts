import { describe, expect, test } from 'bun:test'
import { SERVICE_NAME, UNIT_PATH, composeYaml, systemdUnit } from './templates.ts'

const vars = {
  cloudflaredDir: '/opt/jib/cloudflared',
  tunnelEnvPath: '/opt/jib/secrets/_jib/cloudflare/tunnel.env',
}

describe('cloudflared templates', () => {
  test('composeYaml uses env_file, NOT a volume mount (CLAUDE.md secrets rule)', () => {
    const out = composeYaml(vars)
    expect(out).toContain('env_file:')
    expect(out).toContain(vars.tunnelEnvPath)
    // No raw volume mount of the secret file.
    expect(out).not.toMatch(/volumes:\s*\n\s*-\s*.*tunnel\.env/)
    expect(out).toContain('image: cloudflare/cloudflared:latest')
    expect(out).toContain('network_mode: host')
  })

  test('systemdUnit templates the cloudflared dir into ExecStart/ExecStop', () => {
    const out = systemdUnit(vars)
    expect(out).toContain('/opt/jib/cloudflared/docker-compose.yml')
    expect(out).toContain('ExecStart=')
    expect(out).toContain('ExecStop=')
  })

  test('templates honor JIB_ROOT via templated paths', () => {
    const custom = {
      cloudflaredDir: '/srv/jib/cloudflared',
      tunnelEnvPath: '/srv/jib/secrets/_jib/cloudflare/tunnel.env',
    }
    expect(composeYaml(custom)).toContain('/srv/jib/secrets/_jib/cloudflare/tunnel.env')
    expect(systemdUnit(custom)).toContain('/srv/jib/cloudflared/docker-compose.yml')
  })

  test('service name + unit path constants are stable', () => {
    expect(SERVICE_NAME).toBe('jib-cloudflared.service')
    expect(UNIT_PATH).toBe('/etc/systemd/system/jib-cloudflared.service')
  })
})
