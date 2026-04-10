import { describe, expect, test } from 'bun:test'
import type { CliError } from '@jib/core'
import type { AddFlowResult } from '@jib/flows'
import { type RolledBackAddError, runAddSequence } from '../add-sequence.ts'

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

describe('runAddSequence', () => {
  test('runs add then deploy without rollback on success', async () => {
    const calls: string[] = []
    const result = await runAddSequence(
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
      },
      { interrupted: false, dispose() {} },
    )

    expect(calls).toEqual(['add', 'deploy'])
    expect(result.deployResult.sha).toBe('abcdef1234')
  })

  test('rolls back when deploy fails', async () => {
    const calls: string[] = []
    await expect(
      runAddSequence(
        async () => {
          calls.push('add')
          return addResult
        },
        async () => {
          calls.push('deploy')
          throw new Error('deploy failed')
        },
        async () => {
          calls.push('rollback')
        },
        { interrupted: false, dispose() {} },
      ),
    ).rejects.toMatchObject({
      message: 'deploy failed',
      name: 'RolledBackAddError',
    } satisfies Partial<RolledBackAddError>)

    expect(calls).toEqual(['add', 'deploy', 'rollback'])
  })

  test('rolls back if interrupted after add completes', async () => {
    const calls: string[] = []
    await expect(
      runAddSequence(
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
        },
        {
          interrupted: true,
          dispose() {},
        },
      ),
    ).rejects.toMatchObject({
      message: 'add cancelled',
      name: 'RolledBackAddError',
      original: { code: 'cancelled', message: 'add cancelled' } satisfies Partial<CliError>,
    } satisfies Partial<RolledBackAddError>)

    expect(calls).toEqual(['add', 'rollback'])
  })
})
