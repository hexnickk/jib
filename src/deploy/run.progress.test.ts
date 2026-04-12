import { afterEach, describe, expect, test } from 'bun:test'
import { cliSetRuntime } from '@jib/cli'
import type { Config } from '@jib/config'
import type { Paths } from '@jib/paths'
import { DeployExecuteError, DeployTimeoutError } from './errors.ts'
import { runDeploy, runDeployResult } from './run.ts'

const cfg: Config = {
  config_version: 3,
  poll_interval: '5m',
  modules: {},
  sources: {},
  apps: {
    demo: { repo: 'owner/demo', branch: 'main', domains: [], env_file: '.env' },
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

afterEach(() => {
  cliSetRuntime({ output: 'json' })
})

describe('runDeploy progress and timeout', () => {
  test('times out slow deploys with a deploy_failed cli error', async () => {
    cliSetRuntime({ output: 'json' })
    await expect(
      runDeploy(cfg, paths, 'demo', undefined, 5, {
        sync: async () => ({ sha: '12345678deadbeef', workdir: '/tmp/demo' }),
        createEngine: () =>
          ({
            deploy: async () => {
              await new Promise((resolve) => setTimeout(resolve, 50))
              return { deployedSHA: 'deadbeef12345678', durationMs: 50 }
            },
          }) as never,
      }),
    ).rejects.toMatchObject({
      code: 'deploy_failed',
      message: 'deploy timed out after 5ms',
      hint: 'check docker compose output, then retry `jib deploy ...`',
    })
  })

  test('returns a typed timeout error from the result-first api', async () => {
    cliSetRuntime({ output: 'json' })
    const result = await runDeployResult(cfg, paths, 'demo', undefined, 5, {
      sync: async () => ({ sha: '12345678deadbeef', workdir: '/tmp/demo' }),
      createEngine: () =>
        ({
          deploy: async () => {
            await new Promise((resolve) => setTimeout(resolve, 50))
            return { deployedSHA: 'deadbeef12345678', durationMs: 50 }
          },
        }) as never,
    })

    expect(result).toBeInstanceOf(DeployTimeoutError)
    expect(result).toMatchObject({
      code: 'deploy_timeout',
      message: 'deploy timed out after 5ms',
    })
  })

  test('returns a typed execute error when deploy throws before returning a promise', async () => {
    cliSetRuntime({ output: 'json' })
    const result = await runDeployResult(cfg, paths, 'demo', undefined, 1000, {
      sync: async () => ({ sha: '12345678deadbeef', workdir: '/tmp/demo' }),
      createEngine: () =>
        ({
          deploy: () => {
            throw new Error('engine setup failed')
          },
        }) as never,
    })

    expect(result).toBeInstanceOf(DeployExecuteError)
    expect(result).toMatchObject({
      code: 'deploy_execute_failed',
      message: 'engine setup failed',
    })
  })

  test('text mode reports spinner start, progress, and stop messages in order', async () => {
    cliSetRuntime({ output: 'text' })
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

    const result = await runDeploy(cfg, paths, 'demo', undefined, 1000, {
      createSpinner,
      sync: async () => ({ sha: '12345678deadbeef', workdir: '/tmp/demo' }),
      createEngine: () =>
        ({
          deploy: async (
            _target: unknown,
            progress: { emit(step: string, message: string): void },
          ) => {
            progress.emit('build', 'pulling base image')
            progress.emit('health', 'waiting for /ready')
            return { deployedSHA: 'deadbeef12345678', durationMs: 42 }
          },
        }) as never,
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
