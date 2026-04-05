import { describe, expect, test } from 'bun:test'
import { FakeBus, SUBJECTS, emitAndWait, flush } from '@jib/rpc'

/**
 * The deploy command is glue over `emitAndWait` + bus lifecycle. We don't
 * execute the citty command (that requires a real config on disk + a live
 * bus); instead we verify the exact two-step chain the command produces,
 * making sure a regression in the subjects or payload shape would trip the
 * test.
 */
describe('deploy flow', () => {
  test('prepare-then-deploy chain round-trips via FakeBus', async () => {
    const bus = new FakeBus()
    const captured: Record<string, unknown>[] = []

    bus.subscribe(SUBJECTS.cmd.repoPrepare, (raw) => {
      const cmd = raw as { corrId: string; app: string }
      captured.push({ subject: SUBJECTS.cmd.repoPrepare, ...cmd })
      bus.publish(SUBJECTS.evt.repoReady, {
        corrId: cmd.corrId,
        ts: new Date().toISOString(),
        source: 'gitsitter',
        app: cmd.app,
        workdir: '/tmp/w',
        sha: 'deadbeef',
      })
    })
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

    const ready = await emitAndWait(
      bus.asBus(),
      SUBJECTS.cmd.repoPrepare,
      { app: 'web' },
      { success: SUBJECTS.evt.repoReady, failure: SUBJECTS.evt.repoFailed },
      undefined,
      { source: 'cli', timeoutMs: 1000 },
    )
    expect(ready.workdir).toBe('/tmp/w')
    expect(ready.sha).toBe('deadbeef')

    const done = await emitAndWait(
      bus.asBus(),
      SUBJECTS.cmd.deploy,
      {
        app: 'web',
        workdir: ready.workdir,
        sha: ready.sha,
        trigger: 'manual',
        user: 'tester',
      },
      { success: SUBJECTS.evt.deploySuccess, failure: SUBJECTS.evt.deployFailure },
      undefined,
      { source: 'cli', timeoutMs: 1000 },
    )
    expect(done.durationMs).toBe(1234)

    await flush()
    expect(captured.map((c) => c.subject)).toEqual([SUBJECTS.cmd.repoPrepare, SUBJECTS.cmd.deploy])
  })
})
