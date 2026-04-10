import { describe, expect, test } from 'bun:test'
import { FakeBus, flush } from './fake-bus.ts'
import { handleCmd } from './server.ts'
import { SUBJECTS } from './subjects.ts'

/**
 * These cover the corrId-preservation contracts that `emitAndWait` relies on:
 * if a handler throws or an incoming command fails schema validation, the
 * failure event MUST echo the original corrId, otherwise clients hang until
 * their timeout.
 */
describe('handleCmd', () => {
  test('handler exception publishes failure event with original corrId', async () => {
    const bus = new FakeBus()
    const failures: Array<{ corrId: string; error: string }> = []
    bus.subscribe(SUBJECTS.evt.repoFailed, (raw) => {
      failures.push(raw as { corrId: string; error: string })
    })

    handleCmd(
      bus.asBus(),
      SUBJECTS.cmd.repoPrepare,
      'repo',
      'gitsitter',
      undefined,
      SUBJECTS.evt.repoFailed,
      async () => {
        throw new Error('boom')
      },
    )

    bus.publish(SUBJECTS.cmd.repoPrepare, {
      corrId: 'abc',
      ts: new Date().toISOString(),
      source: 'cli',
      app: 'demo',
      ref: 'main',
    })
    await flush()
    await flush()
    expect(failures).toHaveLength(1)
    expect(failures[0]?.corrId).toBe('abc')
    expect(failures[0]?.error).toBe('boom')
  })

  test('schema-invalid command still emits failure with original corrId', async () => {
    const bus = new FakeBus()
    const failures: Array<{ corrId: string; error: string }> = []
    bus.subscribe(SUBJECTS.evt.repoFailed, (raw) => {
      failures.push(raw as { corrId: string; error: string })
    })

    handleCmd(
      bus.asBus(),
      SUBJECTS.cmd.deploy,
      'deploy',
      'deployer',
      undefined,
      SUBJECTS.evt.deployFailure,
      async () => ({ success: { subject: SUBJECTS.evt.deploySuccess, body: {} as never } }),
    )
    const deployFailures: Array<{ corrId: string; error: string }> = []
    bus.subscribe(SUBJECTS.evt.deployFailure, (raw) => {
      deployFailures.push(raw as { corrId: string; error: string })
    })

    // Missing required `workdir`/`sha`/`trigger` — envelope still valid so
    // the fallback path can recover `corrId` + `app`.
    bus.publish(SUBJECTS.cmd.deploy, {
      corrId: 'xyz',
      ts: new Date().toISOString(),
      source: 'cli',
      app: 'demo',
    })
    await flush()
    await flush()
    expect(deployFailures).toHaveLength(1)
    expect(deployFailures[0]?.corrId).toBe('xyz')
    expect(deployFailures[0]?.error).toContain('invalid')
    // keep the outer `failures` closure alive for biome's unused check
    expect(failures).toHaveLength(0)
  })
})
