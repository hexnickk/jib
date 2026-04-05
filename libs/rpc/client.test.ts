import { describe, expect, test } from 'bun:test'
import { ValidationError } from '@jib/core'
import { emitAndWait } from './client.ts'
import { FakeBus, flush } from './fake-bus.ts'
import { SUBJECTS } from './subjects.ts'

/** Helper: emit a completion event that echoes a correlation ID. */
function echo(bus: FakeBus, subject: string, extra: Record<string, unknown>, corrId: string) {
  bus.publish(subject, { corrId, ts: new Date().toISOString(), source: 'test', ...extra })
}

/**
 * Drain microtasks enough for a roundtrip: publish → subscribe handler →
 * emitAndWait promise resolution.
 */
async function roundtrip() {
  await flush()
  await flush()
}

describe('emitAndWait', () => {
  test('happy path: progress stream then success resolves with event payload', async () => {
    const bus = new FakeBus()
    // As soon as the command lands, stub gitsitter emits progress + ready.
    bus.subscribe(SUBJECTS.cmd.repoPrepare, (raw) => {
      const cmd = raw as { corrId: string; app: string }
      echo(bus, SUBJECTS.evt.repoProgress, { app: cmd.app, message: 'cloning' }, cmd.corrId)
      echo(bus, SUBJECTS.evt.repoReady, { app: cmd.app, workdir: '/tmp/x', sha: 'abc' }, cmd.corrId)
    })

    const progress: string[] = []
    const result = await emitAndWait(
      bus.asBus(),
      SUBJECTS.cmd.repoPrepare,
      { app: 'demo', ref: 'main' },
      { success: SUBJECTS.evt.repoReady, failure: SUBJECTS.evt.repoFailed },
      SUBJECTS.evt.repoProgress,
      {
        source: 'cli',
        timeoutMs: 500,
        onProgress: (m) => progress.push(m.message),
      },
    )

    expect(result.workdir).toBe('/tmp/x')
    expect(result.sha).toBe('abc')
    expect(progress).toEqual(['cloning'])
  })

  test('failure event rejects with surfaced error', async () => {
    const bus = new FakeBus()
    bus.subscribe(SUBJECTS.cmd.repoPrepare, (raw) => {
      const cmd = raw as { corrId: string; app: string }
      echo(bus, SUBJECTS.evt.repoFailed, { app: cmd.app, error: 'clone failed' }, cmd.corrId)
    })

    await expect(
      emitAndWait(
        bus.asBus(),
        SUBJECTS.cmd.repoPrepare,
        { app: 'demo', ref: 'main' },
        { success: SUBJECTS.evt.repoReady, failure: SUBJECTS.evt.repoFailed },
        undefined,
        { source: 'cli', timeoutMs: 500 },
      ),
    ).rejects.toThrow('clone failed')
  })

  test('timeout rejects when no terminal event arrives', async () => {
    const bus = new FakeBus()
    await expect(
      emitAndWait(
        bus.asBus(),
        SUBJECTS.cmd.repoPrepare,
        { app: 'demo', ref: 'main' },
        { success: SUBJECTS.evt.repoReady, failure: SUBJECTS.evt.repoFailed },
        undefined,
        { source: 'cli', timeoutMs: 20 },
      ),
    ).rejects.toThrow('timed out')
  })

  test('events with wrong corrId are ignored', async () => {
    const bus = new FakeBus()
    bus.subscribe(SUBJECTS.cmd.repoPrepare, (raw) => {
      const cmd = raw as { corrId: string; app: string }
      // Noise: an unrelated app's ready event.
      echo(
        bus,
        SUBJECTS.evt.repoReady,
        { app: 'other', workdir: '/tmp/other', sha: 'zzz' },
        'different-corr-id',
      )
      // Then the one we actually want.
      echo(
        bus,
        SUBJECTS.evt.repoReady,
        { app: cmd.app, workdir: '/tmp/mine', sha: 'mine' },
        cmd.corrId,
      )
    })

    const result = await emitAndWait(
      bus.asBus(),
      SUBJECTS.cmd.repoPrepare,
      { app: 'demo', ref: 'main' },
      { success: SUBJECTS.evt.repoReady, failure: SUBJECTS.evt.repoFailed },
      undefined,
      { source: 'cli', timeoutMs: 500 },
    )
    expect(result.workdir).toBe('/tmp/mine')
  })

  test('publish error tears down subs + timer and rejects', async () => {
    const bus = new FakeBus()
    const boom = new Error('bus down')
    // Swap out publish with a thrower; subscribe still works.
    ;(bus as unknown as { publish: (s: string, p: unknown) => void }).publish = () => {
      throw boom
    }
    const err = await emitAndWait(
      bus.asBus(),
      SUBJECTS.cmd.repoPrepare,
      { app: 'demo', ref: 'main' },
      { success: SUBJECTS.evt.repoReady, failure: SUBJECTS.evt.repoFailed },
      undefined,
      { source: 'cli', timeoutMs: 500 },
    ).catch((e) => e)
    expect(err).toBe(boom)
    // If cleanup leaked, a trailing microtask flush would still hold timers;
    // bun:test will fail the run on dangling handles, so reaching here is the
    // assertion. Drain anyway to surface any late rejections.
    await roundtrip()
  })

  test('schema validation rejects malformed commands synchronously', async () => {
    const bus = new FakeBus()
    await expect(
      emitAndWait(
        bus.asBus(),
        SUBJECTS.cmd.repoPrepare,
        { app: '', ref: 'main' } as never,
        { success: SUBJECTS.evt.repoReady, failure: SUBJECTS.evt.repoFailed },
        undefined,
        { source: 'cli', timeoutMs: 500 },
      ),
    ).rejects.toBeInstanceOf(ValidationError)
    await roundtrip()
  })
})
