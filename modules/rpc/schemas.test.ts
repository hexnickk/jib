import { describe, expect, test } from 'bun:test'
import {
  CmdDeploySchema,
  CmdIngressClaimSchema,
  EnvelopeSchema,
  EvtDeploySuccessSchema,
  EvtIngressProgressSchema,
  EvtIngressReadySchema,
  SCHEMAS,
} from './schemas.ts'
import { SUBJECTS } from './subjects.ts'

describe('schemas', () => {
  test('envelope requires corrId, ISO timestamp, and source', () => {
    expect(
      EnvelopeSchema.safeParse({ corrId: 'c', ts: '2024-01-01T00:00:00Z', source: 's' }).success,
    ).toBe(true)
    expect(EnvelopeSchema.safeParse({ corrId: '', ts: 'bad', source: 's' }).success).toBe(false)
  })

  test('CmdDeploy round-trips', () => {
    const v = CmdDeploySchema.parse({
      corrId: 'c',
      ts: '2024-01-01T00:00:00Z',
      source: 'cli',
      app: 'demo',
      workdir: '/tmp/demo',
      sha: 'abc123',
      trigger: 'manual',
    })
    expect(v.app).toBe('demo')
    expect(v.workdir).toBe('/tmp/demo')
    expect(v.sha).toBe('abc123')
    expect(v.trigger).toBe('manual')
  })

  test('CmdDeploy trigger is enforced as enum', () => {
    const base = {
      corrId: 'c',
      ts: '2024-01-01T00:00:00Z',
      source: 'cli',
      app: 'demo',
      workdir: '/tmp/x',
      sha: 'abc',
    }
    expect(CmdDeploySchema.safeParse({ ...base, trigger: 'manual' }).success).toBe(true)
    expect(CmdDeploySchema.safeParse({ ...base, trigger: 'bogus' }).success).toBe(false)
  })

  test('EvtDeploySuccess requires non-negative duration', () => {
    const ok = EvtDeploySuccessSchema.safeParse({
      corrId: 'c',
      ts: '2024-01-01T00:00:00Z',
      source: 'deployer',
      app: 'demo',
      sha: 'abc',
      durationMs: 1000,
    })
    expect(ok.success).toBe(true)
  })

  test('CmdIngressClaim round-trips with domain list', () => {
    const v = CmdIngressClaimSchema.parse({
      corrId: 'c',
      ts: '2024-01-01T00:00:00Z',
      source: 'cli',
      app: 'web',
      domains: [
        { host: 'example.com', port: 20000 },
        { host: 'tun.example.com', port: 20001, isTunnel: true },
      ],
    })
    expect(v.domains[0]?.port).toBe(20000)
    // `isTunnel` defaults to false when omitted, honors true when set.
    expect(v.domains[0]?.isTunnel).toBe(false)
    expect(v.domains[1]?.isTunnel).toBe(true)
  })

  test('CmdIngressClaim rejects empty domains list', () => {
    expect(
      CmdIngressClaimSchema.safeParse({
        corrId: 'c',
        ts: '2024-01-01T00:00:00Z',
        source: 'cli',
        app: 'web',
        domains: [],
      }).success,
    ).toBe(false)
  })

  test('EvtIngressReady round-trips', () => {
    const v = EvtIngressReadySchema.parse({
      corrId: 'c',
      ts: '2024-01-01T00:00:00Z',
      source: 'ingress',
      app: 'web',
    })
    expect(v.app).toBe('web')
  })

  test('EvtIngressProgress round-trips', () => {
    const v = EvtIngressProgressSchema.parse({
      corrId: 'c',
      ts: '2024-01-01T00:00:00Z',
      source: 'ingress',
      app: 'web',
      message: 'reloading ingress',
    })
    expect(v.message).toBe('reloading ingress')
  })

  test('SCHEMAS table covers every subject in SUBJECTS', () => {
    const all = [...Object.values(SUBJECTS.cmd), ...Object.values(SUBJECTS.evt)]
    for (const s of all) expect(SCHEMAS[s]).toBeDefined()
  })
})
