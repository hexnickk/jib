import { runDeploy } from '@/flows/deploy/run.ts'
import type { CliError } from '@jib/cli'
import type { Config } from '@jib/config'
import type { Paths } from '@jib/paths'
import { describe, expect, test, vi } from 'vitest'
import { type AddRolledBackError, addRunSequence } from './sequence.ts'
import type { AddFlowResult } from './types.ts'

const addResult: AddFlowResult = {
  finalApp: {
    repo: 'owner/blog',
    branch: 'main',
    compose: ['docker-compose.yml'],
    domains: [],
    services: ['blog'],
  },
  secretsWritten: 1,
}

const deployConfig: Config = {
  config_version: 3,
  poll_interval: '5m',
  modules: {},
  sources: {},
  apps: {
    blog: { repo: 'owner/blog', branch: 'main', domains: [] },
  },
}

const deployPaths: Paths = {
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

/** Creates a no-op spinner so lifecycle tests do not write progress output. */
function createNoopSpinner() {
  return {
    start() {},
    message() {},
    stop() {},
  }
}

/** Creates a caller-controlled promise for testing asynchronous lifecycle ordering. */
function createDeferred<T>(): { promise: Promise<T>; resolve(value: T): void } {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((finish) => {
    resolve = finish
  })
  return { promise, resolve }
}

describe('addRunSequence', () => {
  test('runs add then deploy without rollback on success', async () => {
    const calls: string[] = []
    const result = await addRunSequence(
      async () => {
        calls.push('add')
        return addResult
      },
      async () => {
        calls.push('deploy')
        return {
          app: 'blog',
          durationMs: 42,
          preparedSha: '1234567890',
          sha: 'abcdef1234',
          workdir: '/tmp/blog',
        }
      },
      async () => {
        calls.push('rollback')
        return undefined
      },
      { interrupted: false },
    )
    if (result instanceof Error) throw result

    expect(calls).toEqual(['add', 'deploy'])
    expect(result.deployResult.sha).toBe('abcdef1234')
  })

  test('rolls back when deploy fails', async () => {
    const calls: string[] = []
    const result = await addRunSequence(
      async () => {
        calls.push('add')
        return addResult
      },
      async () => {
        calls.push('deploy')
        return new Error('deploy failed')
      },
      async () => {
        calls.push('rollback')
        return undefined
      },
      { interrupted: false },
    )
    expect(result).toMatchObject({
      message: 'deploy failed',
      name: 'AddRolledBackError',
    } satisfies Partial<AddRolledBackError>)

    expect(calls).toEqual(['add', 'deploy', 'rollback'])
  })

  test('does not roll back add while deployment is still active', async () => {
    vi.useFakeTimers()
    const deployment = createDeferred<{ deployedSHA: string; durationMs: number }>()
    const deploymentStarted = createDeferred<void>()
    const calls: string[] = []

    try {
      const sequence = addRunSequence(
        async () => {
          calls.push('add')
          return addResult
        },
        async () => {
          calls.push('deploy')
          return await runDeploy(deployConfig, deployPaths, 'blog', undefined, {
            createSpinner: createNoopSpinner,
            sync: async () => ({ sha: '1234567890', workdir: '/tmp/blog' }),
            deployPrepared: async () => {
              deploymentStarted.resolve()
              return await deployment.promise
            },
          })
        },
        async () => {
          calls.push('rollback')
          return undefined
        },
        { interrupted: false },
      )

      await deploymentStarted.promise
      await vi.advanceTimersByTimeAsync(10 * 60_000)
      expect(calls).toEqual(['add', 'deploy'])

      deployment.resolve({ deployedSHA: 'abcdef1234', durationMs: 42 })
      const result = await sequence
      if (result instanceof Error) throw result
      expect(calls).toEqual(['add', 'deploy'])
      expect(result.deployResult.sha).toBe('abcdef1234')
    } finally {
      vi.useRealTimers()
    }
  })

  test('rolls back if interrupted after add completes', async () => {
    const calls: string[] = []
    const result = await addRunSequence(
      async () => {
        calls.push('add')
        return addResult
      },
      async () => {
        calls.push('deploy')
        return {
          app: 'blog',
          durationMs: 42,
          preparedSha: '1234567890',
          sha: 'abcdef1234',
          workdir: '/tmp/blog',
        }
      },
      async () => {
        calls.push('rollback')
        return undefined
      },
      { interrupted: true },
    )
    expect(result).toMatchObject({
      message: 'add cancelled',
      name: 'AddRolledBackError',
      original: { code: 'cancelled', message: 'add cancelled' } satisfies Partial<CliError>,
    } satisfies Partial<AddRolledBackError>)

    expect(calls).toEqual(['add', 'rollback'])
  })

  test('does not roll back after a successful deploy even if interrupted late', async () => {
    const calls: string[] = []
    let interrupted = false

    const result = await addRunSequence(
      async () => {
        calls.push('add')
        return addResult
      },
      async () => {
        calls.push('deploy')
        interrupted = true
        return {
          app: 'blog',
          durationMs: 42,
          preparedSha: '1234567890',
          sha: 'abcdef1234',
          workdir: '/tmp/blog',
        }
      },
      async () => {
        calls.push('rollback')
        return undefined
      },
      {
        get interrupted() {
          return interrupted
        },
      },
    )
    if (result instanceof Error) throw result

    expect(calls).toEqual(['add', 'deploy'])
    expect(result.deployResult.sha).toBe('abcdef1234')
  })
})
