import { describe, expect, test } from 'bun:test'
import { SERVICE_NAME, UNIT_PATH, composeYaml, natsConf, systemdUnit } from './templates.ts'

const vars = { busDir: '/opt/jib/bus' }

describe('nats templates', () => {
  test('composeYaml references nats:alpine and binds loopback', () => {
    const out = composeYaml(vars)
    expect(out).toContain('image: nats:alpine')
    expect(out).toContain('127.0.0.1:4222:4222')
    expect(out).toContain('name: jib-bus')
  })

  test('natsConf is a non-empty comment block', () => {
    const out = natsConf(vars)
    expect(out.length).toBeGreaterThan(0)
    expect(out).toContain('Managed by jib')
  })

  test('systemdUnit templates the bus dir into ExecStart and ExecStop', () => {
    const out = systemdUnit(vars)
    expect(out).toContain('/opt/jib/bus/docker-compose.yml')
    expect(out).toContain('ExecStart=')
    expect(out).toContain('ExecStop=')
    expect(out).toContain('After=docker.service')
  })

  test('systemdUnit honors JIB_ROOT via busDir', () => {
    const out = systemdUnit({ busDir: '/tmp/jib-test/bus' })
    expect(out).toContain('/tmp/jib-test/bus/docker-compose.yml')
    expect(out).not.toContain('/opt/jib/bus')
  })

  test('service name + unit path constants are stable', () => {
    expect(SERVICE_NAME).toBe('jib-bus.service')
    expect(UNIT_PATH).toBe('/etc/systemd/system/jib-bus.service')
  })
})
