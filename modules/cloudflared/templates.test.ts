import { describe, expect, test } from 'bun:test'
import {
  CLOUDFLARED_SERVICE_NAME,
  CLOUDFLARED_UNIT_PATH,
  cloudflaredComposeYaml,
  cloudflaredSystemdUnit,
} from './templates.ts'

const vars = {
  cloudflaredDir: '/opt/jib/cloudflared',
  tunnelEnvPath: '/opt/jib/secrets/_jib/cloudflare/tunnel.env',
}

describe('cloudflared templates', () => {
  test('cloudflaredComposeYaml uses env_file, NOT a volume mount (CLAUDE.md secrets rule)', () => {
    const out = cloudflaredComposeYaml(vars)
    expect(out).toContain('env_file:')
    expect(out).toContain(vars.tunnelEnvPath)
    expect(out).not.toMatch(/volumes:\s*\n\s*-\s*.*tunnel\.env/)
    expect(out).toContain('image: cloudflare/cloudflared:latest')
    expect(out).toContain('network_mode: host')
  })

  test('cloudflaredSystemdUnit templates the cloudflared dir into ExecStart/ExecStop', () => {
    const out = cloudflaredSystemdUnit(vars)
    expect(out).toContain('/opt/jib/cloudflared/docker-compose.yml')
    expect(out).toContain('ExecStart=')
    expect(out).toContain('ExecStop=')
  })

  test('templates honor JIB_ROOT via templated paths', () => {
    const custom = {
      cloudflaredDir: '/srv/jib/cloudflared',
      tunnelEnvPath: '/srv/jib/secrets/_jib/cloudflare/tunnel.env',
    }
    expect(cloudflaredComposeYaml(custom)).toContain('/srv/jib/secrets/_jib/cloudflare/tunnel.env')
    expect(cloudflaredSystemdUnit(custom)).toContain('/srv/jib/cloudflared/docker-compose.yml')
  })

  test('service name + unit path constants are stable', () => {
    expect(CLOUDFLARED_SERVICE_NAME).toBe('jib-cloudflared.service')
    expect(CLOUDFLARED_UNIT_PATH).toBe('/etc/systemd/system/jib-cloudflared.service')
  })
})
