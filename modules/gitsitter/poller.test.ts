import { describe, expect, test } from 'bun:test'
import type { Config } from '@jib/config'
import { createLogger, getPaths } from '@jib/core'
import { FakeBus, SUBJECTS, flush } from '@jib/rpc'
import { type PollAppDeps, parsePollInterval, pollApp } from './poller.ts'

function mkCfg(overrides: Partial<Config> = {}): Config {
  return {
    config_version: 3,
    poll_interval: '5m',
    apps: {
      demo: {
        repo: 'acme/demo',
        branch: 'main',
        domains: [{ host: 'demo.example.com', port: 3000 }],
        env_file: '.env',
      },
    },
    ...overrides,
  } as Config
}

describe('parsePollInterval', () => {
  test('parses seconds, minutes, hours', () => {
    expect(parsePollInterval('30s')).toBe(30_000)
    expect(parsePollInterval('5m')).toBe(300_000)
    expect(parsePollInterval('1h')).toBe(3_600_000)
  })
  test('defaults to 5m on garbage', () => {
    expect(parsePollInterval('nonsense')).toBe(300_000)
  })
})

describe('pollApp', () => {
  test('new sha publishes cmd.deploy; same sha is a no-op', async () => {
    const bus = new FakeBus()
    const cfg = mkCfg()
    const paths = getPaths('/tmp/jib-root-test')
    const seen = new Map<string, string>()
    const log = createLogger('test')
    const deploys: unknown[] = []
    bus.subscribe(SUBJECTS.cmd.deploy, (p) => {
      deploys.push(p)
    })

    const lsRemote: NonNullable<PollAppDeps['lsRemote']> = async () =>
      'abc123abc123abc123abc123abc123abc123abc1'

    await pollApp(bus.asBus(), cfg, paths, 'demo', seen, log, { lsRemote })
    await flush()
    expect(deploys).toHaveLength(1)

    await pollApp(bus.asBus(), cfg, paths, 'demo', seen, log, { lsRemote })
    await flush()
    expect(deploys).toHaveLength(1) // unchanged
  })
})
