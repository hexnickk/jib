import { describe, expect, test } from 'bun:test'
import type { CliError } from '@jib/cli'
import { type AddRolledBackError, addRunSequence } from './sequence.ts'
import type { AddFlowResult } from './types.ts'

const addResult: AddFlowResult = {
  finalApp: {
    repo: 'owner/blog',
    branch: 'main',
    compose: ['docker-compose.yml'],
    domains: [],
    env_file: '.env',
    services: ['blog'],
  },
  secretsWritten: 1,
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
