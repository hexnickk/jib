import { describe, expect, test } from 'bun:test'
import { FakeBus, flush } from './fake-bus.ts'
import { handleCmd } from './server.ts'
import { SUBJECTS } from './subjects.ts'

describe('handleCmd', () => {
  test('handler exception publishes failure event with original corrId', async () => {
    const bus = new FakeBus()
    const failures: Array<{ corrId: string; error: string }> = []
    bus.subscribe(SUBJECTS.evt.deployFailure, (raw) => {
      failures.push(raw as { corrId: string; error: string })
    })

    handleCmd(
      bus.asBus(),
      SUBJECTS.cmd.deploy,
      'deploy',
      'deployer',
      undefined,
      SUBJECTS.evt.deployFailure,
      async () => {
        throw new Error('boom')
      },
    )

    bus.publish(SUBJECTS.cmd.deploy, {
      corrId: 'abc',
      ts: new Date().toISOString(),
      source: 'cli',
      app: 'demo',
      workdir: '/tmp/demo',
      sha: 'abc123',
      trigger: 'manual',
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
    bus.subscribe(SUBJECTS.evt.deployFailure, (raw) => {
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

    bus.publish(SUBJECTS.cmd.deploy, {
      corrId: 'xyz',
      ts: new Date().toISOString(),
      source: 'cli',
      app: 'demo',
    })
    await flush()
    await flush()
    expect(failures).toHaveLength(1)
    expect(failures[0]?.corrId).toBe('xyz')
    expect(failures[0]?.error).toContain('invalid')
  })
})
