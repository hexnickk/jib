import { describe, expect, test } from 'bun:test'
import { ValidationError } from '@jib/core'
import { emitAndWait } from './client.ts'
import { FakeBus, flush } from './fake-bus.ts'
import { SUBJECTS } from './subjects.ts'

function echo(bus: FakeBus, subject: string, extra: Record<string, unknown>, corrId: string) {
  bus.publish(subject, { corrId, ts: new Date().toISOString(), source: 'test', ...extra })
}

async function roundtrip() {
  await flush()
  await flush()
}

const deployPayload = {
  app: 'demo',
  workdir: '/tmp/demo',
  sha: 'abc123',
  trigger: 'manual' as const,
}

describe('emitAndWait', () => {
  test('happy path: progress stream then success resolves with event payload', async () => {
    const bus = new FakeBus()
    bus.subscribe(SUBJECTS.cmd.deploy, (raw) => {
      const cmd = raw as { corrId: string; app: string; sha: string }
      echo(
        bus,
        SUBJECTS.evt.deployProgress,
        { app: cmd.app, step: 'clone', message: 'ready' },
        cmd.corrId,
      )
      echo(
        bus,
        SUBJECTS.evt.deploySuccess,
        { app: cmd.app, sha: cmd.sha, durationMs: 25 },
        cmd.corrId,
      )
    })

    const progress: string[] = []
    const result = await emitAndWait(
      bus.asBus(),
      SUBJECTS.cmd.deploy,
      deployPayload,
      { success: SUBJECTS.evt.deploySuccess, failure: SUBJECTS.evt.deployFailure },
      SUBJECTS.evt.deployProgress,
      { source: 'cli', timeoutMs: 500, onProgress: (m) => progress.push(m.message) },
    )

    expect(result.sha).toBe('abc123')
    expect(result.durationMs).toBe(25)
    expect(progress).toEqual(['ready'])
  })

  test('failure event rejects with surfaced error', async () => {
    const bus = new FakeBus()
    bus.subscribe(SUBJECTS.cmd.deploy, (raw) => {
      const cmd = raw as { corrId: string; app: string }
      echo(bus, SUBJECTS.evt.deployFailure, { app: cmd.app, error: 'deploy failed' }, cmd.corrId)
    })

    await expect(
      emitAndWait(
        bus.asBus(),
        SUBJECTS.cmd.deploy,
        deployPayload,
        { success: SUBJECTS.evt.deploySuccess, failure: SUBJECTS.evt.deployFailure },
        undefined,
        { source: 'cli', timeoutMs: 500 },
      ),
    ).rejects.toThrow('deploy failed')
  })

  test('timeout rejects when no terminal event arrives', async () => {
    const bus = new FakeBus()
    await expect(
      emitAndWait(
        bus.asBus(),
        SUBJECTS.cmd.deploy,
        deployPayload,
        { success: SUBJECTS.evt.deploySuccess, failure: SUBJECTS.evt.deployFailure },
        undefined,
        { source: 'cli', timeoutMs: 20 },
      ),
    ).rejects.toThrow('timed out')
  })

  test('events with wrong corrId are ignored', async () => {
    const bus = new FakeBus()
    bus.subscribe(SUBJECTS.cmd.deploy, (raw) => {
      const cmd = raw as { corrId: string; app: string; sha: string }
      echo(
        bus,
        SUBJECTS.evt.deploySuccess,
        { app: 'other', sha: 'zzz', durationMs: 1 },
        'different-corr-id',
      )
      echo(
        bus,
        SUBJECTS.evt.deploySuccess,
        { app: cmd.app, sha: cmd.sha, durationMs: 2 },
        cmd.corrId,
      )
    })

    const result = await emitAndWait(
      bus.asBus(),
      SUBJECTS.cmd.deploy,
      deployPayload,
      { success: SUBJECTS.evt.deploySuccess, failure: SUBJECTS.evt.deployFailure },
      undefined,
      { source: 'cli', timeoutMs: 500 },
    )
    expect(result.durationMs).toBe(2)
  })

  test('publish error tears down subs + timer and rejects', async () => {
    const bus = new FakeBus()
    const boom = new Error('bus down')
    ;(bus as unknown as { publish: (s: string, p: unknown) => void }).publish = () => {
      throw boom
    }
    const err = await emitAndWait(
      bus.asBus(),
      SUBJECTS.cmd.deploy,
      deployPayload,
      { success: SUBJECTS.evt.deploySuccess, failure: SUBJECTS.evt.deployFailure },
      undefined,
      { source: 'cli', timeoutMs: 500 },
    ).catch((e) => e)
    expect(err).toBe(boom)
    await roundtrip()
  })

  test('schema validation rejects malformed commands synchronously', async () => {
    const bus = new FakeBus()
    await expect(
      emitAndWait(
        bus.asBus(),
        SUBJECTS.cmd.deploy,
        { ...deployPayload, app: '' } as never,
        { success: SUBJECTS.evt.deploySuccess, failure: SUBJECTS.evt.deployFailure },
        undefined,
        { source: 'cli', timeoutMs: 500 },
      ),
    ).rejects.toBeInstanceOf(ValidationError)
    await roundtrip()
  })
})
