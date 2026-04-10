import { describe, expect, test } from 'bun:test'
import { FakeBus, SUBJECTS, emitAndWait, flush } from '@jib/rpc'

/**
 * The deploy command still talks to the deployer over the bus, but repo prep
 * is now a direct shared-package call. This test keeps the remaining bus leg
 * honest without asserting the old repo-prepare hop.
 */
describe('deploy flow', () => {
  test('deploy command payload round-trips via FakeBus', async () => {
    const bus = new FakeBus()
    const captured: Record<string, unknown>[] = []

    bus.subscribe(SUBJECTS.cmd.deploy, (raw) => {
      const cmd = raw as { corrId: string; app: string; workdir: string; sha: string }
      captured.push({ subject: SUBJECTS.cmd.deploy, ...cmd })
      bus.publish(SUBJECTS.evt.deploySuccess, {
        corrId: cmd.corrId,
        ts: new Date().toISOString(),
        source: 'deployer',
        app: cmd.app,
        sha: cmd.sha,
        durationMs: 1234,
      })
    })

    const done = await emitAndWait(
      bus.asBus(),
      SUBJECTS.cmd.deploy,
      {
        app: 'web',
        workdir: '/tmp/w',
        sha: 'deadbeef',
        trigger: 'manual',
        user: 'tester',
      },
      { success: SUBJECTS.evt.deploySuccess, failure: SUBJECTS.evt.deployFailure },
      undefined,
      { source: 'cli', timeoutMs: 1000 },
    )
    expect(done.durationMs).toBe(1234)

    await flush()
    expect(captured.map((c) => c.subject)).toEqual([SUBJECTS.cmd.deploy])
  })
})
