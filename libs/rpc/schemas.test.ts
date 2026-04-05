import { describe, expect, test } from 'bun:test'
import {
  CmdDeploySchema,
  CmdRepoPrepareSchema,
  EnvelopeSchema,
  EvtDeploySuccessSchema,
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

  test('CmdRepoPrepare round-trips', () => {
    const v = CmdRepoPrepareSchema.parse({
      corrId: 'c',
      ts: '2024-01-01T00:00:00Z',
      source: 'cli',
      app: 'demo',
      ref: 'main',
    })
    expect(v.app).toBe('demo')
    expect(v.ref).toBe('main')
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

  test('SCHEMAS table covers every subject in SUBJECTS', () => {
    const all = [...Object.values(SUBJECTS.cmd), ...Object.values(SUBJECTS.evt)]
    for (const s of all) expect(SCHEMAS[s]).toBeDefined()
  })
})
