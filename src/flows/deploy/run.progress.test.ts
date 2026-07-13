import type { Config } from '@jib/config'
import type { Paths } from '@jib/paths'
import { describe, expect, test } from 'vitest'
import { DeployExecuteError } from './errors.ts'
import { runDeploy, runDeployResult } from './run.ts'

const cfg: Config = {
  config_version: 3,
  poll_interval: '5m',
  modules: {},
  sources: {},
  apps: {
    demo: { repo: 'owner/demo', branch: 'main', domains: [] },
  },
}

const paths: Paths = {
  root: '/opt/jib',
  repoRoot: '/opt/jib/src',
  configFile: '/opt/jib/config.yml',
  cloudflaredDir: '/opt/jib/cloudflared',
  locksDir: '/opt/jib/locks',
  nginxDir: '/opt/jib/nginx',
  overridesDir: '/opt/jib/overrides',
  composeDir: '/opt/jib/compose',
  reposDir: '/opt/jib/repos',
  secretsDir: '/opt/jib/secrets',
  stateDir: '/opt/jib/state',
}

/** Creates a no-op spinner for tests that only assert deploy errors. */
function createNoopSpinner() {
  return {
    start() {},
    message() {},
    stop() {},
  }
}

describe('runDeploy progress', () => {
  test('returns a typed execute error when deploy throws before returning a promise', async () => {
    const result = await runDeployResult(cfg, paths, 'demo', undefined, {
      createSpinner: createNoopSpinner,
      sync: async () => ({ sha: '12345678deadbeef', workdir: '/tmp/demo' }),
      deployPrepared: () => {
        throw new Error('engine setup failed')
      },
    })

    expect(result).toBeInstanceOf(DeployExecuteError)
    expect(result).toMatchObject({
      code: 'deploy_execute_failed',
      message: 'engine setup failed',
    })
  })

  test('reports spinner start, progress, and stop messages in order', async () => {
    const events: string[] = []
    const createSpinner = () => ({
      start(value: string) {
        events.push(`start:${value}`)
      },
      message(value: string) {
        events.push(`message:${value}`)
      },
      stop(value: string) {
        events.push(`stop:${value}`)
      },
    })

    const result = await runDeploy(cfg, paths, 'demo', undefined, {
      createSpinner,
      sync: async () => ({ sha: '12345678deadbeef', workdir: '/tmp/demo' }),
      deployPrepared: async (_deps, _target, progress) => {
        progress.emit('build', 'pulling base image')
        progress.emit('health', 'waiting for /ready')
        return { deployedSHA: 'deadbeef12345678', durationMs: 42 }
      },
    })

    expect(result.sha).toBe('deadbeef12345678')
    expect(events).toEqual([
      'start:[1/2] preparing demo',
      'stop:[1/2] repo ready @ 12345678',
      'start:[2/2] deploying demo',
      'message:build: pulling base image',
      'message:health: waiting for /ready',
      'stop:[2/2] demo deployed @ deadbeef (42ms)',
    ])
  })
})
