import { describe, expect, test } from 'bun:test'
import type { Config } from '@jib/config'
import { loggingCreateLogger } from '@jib/logging'
import { getPaths } from '@jib/paths'
import { WatcherDeployAppError, WatcherSyncAppError } from './errors.ts'
import { type PollAppDeps, parsePollInterval, pollApp, runPoller } from './poller.ts'

function mkCfg(overrides: Partial<Config> = {}): Config {
  return {
    config_version: 3,
    poll_interval: '5m',
    sources: {},
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
  test('parses supported config durations', () => {
    expect(parsePollInterval('30s')).toBe(30_000)
    expect(parsePollInterval('5m')).toBe(300_000)
    expect(parsePollInterval('1h')).toBe(3_600_000)
    expect(parsePollInterval('1.5h')).toBe(5_400_000)
    expect(parsePollInterval('1h30m')).toBe(5_400_000)
  })

  test('defaults to 5m on garbage', () => {
    expect(parsePollInterval('nonsense')).toBe(300_000)
  })
})

describe('pollApp', () => {
  test('new sha deploys from the prepared checkout; same sha is a no-op', async () => {
    const cfg = mkCfg()
    const paths = getPaths('/tmp/jib-root-test')
    const seen = new Map<string, string>()
    const log = loggingCreateLogger('test')
    const deploys: unknown[] = []

    const sha = 'abc123abc123abc123abc123abc123abc123abc1'
    const lsRemote: NonNullable<PollAppDeps['lsRemote']> = async () => sha
    const syncApp: NonNullable<PollAppDeps['syncApp']> = async () => ({
      workdir: '/tmp/prepared-demo',
      sha,
    })
    const deployPrepared: NonNullable<PollAppDeps['deployPrepared']> = async (
      _cfg,
      _paths,
      appName,
      prepared,
      _log,
    ) => {
      deploys.push({ app: appName, ...prepared })
      return undefined
    }

    expect(
      await pollApp(cfg, paths, 'demo', seen, log, { lsRemote, syncApp, deployPrepared }),
    ).toBeUndefined()
    expect(deploys).toHaveLength(1)
    expect(deploys[0]).toMatchObject({ app: 'demo', workdir: '/tmp/prepared-demo', sha })

    expect(
      await pollApp(cfg, paths, 'demo', seen, log, { lsRemote, syncApp, deployPrepared }),
    ).toBeUndefined()
    expect(deploys).toHaveLength(1)
  })

  test('failed deploy does not mark the sha as seen', async () => {
    const cfg = mkCfg()
    const paths = getPaths('/tmp/jib-root-test')
    const seen = new Map<string, string>()
    const log = loggingCreateLogger('test')
    const sha = 'abc123abc123abc123abc123abc123abc123abc1'

    const error = await pollApp(cfg, paths, 'demo', seen, log, {
      lsRemote: async () => sha,
      syncApp: async () => ({ workdir: '/tmp/prepared-demo', sha }),
      deployPrepared: async () => new WatcherDeployAppError('demo', new Error('deploy boom')),
    })

    expect(error).toBeInstanceOf(WatcherDeployAppError)
    expect(seen.has('demo')).toBe(false)
  })

  test('thrown deploy failure returns a typed watcher error', async () => {
    const cfg = mkCfg()
    const paths = getPaths('/tmp/jib-root-test')
    const seen = new Map<string, string>()
    const log = loggingCreateLogger('test')
    const sha = 'abc123abc123abc123abc123abc123abc123abc1'

    const error = await pollApp(cfg, paths, 'demo', seen, log, {
      lsRemote: async () => sha,
      syncApp: async () => ({ workdir: '/tmp/prepared-demo', sha }),
      deployPrepared: async () => {
        throw new Error('deploy boom')
      },
    })

    expect(error).toBeInstanceOf(WatcherDeployAppError)
    expect(error?.message).toContain('deploy boom')
    expect(seen.has('demo')).toBe(false)
  })

  test('sync failure returns a typed watcher error', async () => {
    const cfg = mkCfg()
    const paths = getPaths('/tmp/jib-root-test')
    const seen = new Map<string, string>()
    const log = loggingCreateLogger('test')
    const sha = 'abc123abc123abc123abc123abc123abc123abc1'

    const error = await pollApp(cfg, paths, 'demo', seen, log, {
      lsRemote: async () => sha,
      syncApp: async () => {
        throw new Error('sync boom')
      },
    })

    expect(error).toBeInstanceOf(WatcherSyncAppError)
    expect(error?.message).toContain('sync boom')
    expect(seen.has('demo')).toBe(false)
  })
})

describe('runPoller', () => {
  test('stops promptly when aborted during sleep', async () => {
    const cfg = mkCfg({ apps: {} as Config['apps'] })
    const paths = getPaths('/tmp/jib-root-test')
    const log = loggingCreateLogger('test')
    const abort = new AbortController()
    let sleepCalls = 0
    let configLoads = 0

    const run = runPoller(
      {
        paths,
        log,
        getConfig: () => {
          configLoads++
          return cfg
        },
        sleep: async (_ms, signal) => {
          sleepCalls++
          await new Promise<void>((resolve) => {
            signal.addEventListener('abort', () => resolve(), { once: true })
          })
        },
      },
      abort.signal,
    )

    await new Promise((resolve) => setTimeout(resolve, 0))
    abort.abort()
    await run

    expect(configLoads).toBe(1)
    expect(sleepCalls).toBe(1)
  })
})
