import { describe, expect, test } from 'bun:test'
import { gatherAddInputs } from './inputs.ts'

describe('gatherAddInputs', () => {
  test('parses runtime, build, and shared config entries', async () => {
    const inputs = await gatherAddInputs({
      repo: 'owner/blog',
      env: ['DATABASE_URL=postgres://db'],
      'build-arg': ['VITE_HOST_URL=https://example.com'],
      'build-env': ['PUBLIC_URL=https://example.com'],
    })

    expect(inputs.configEntries).toEqual([
      { key: 'DATABASE_URL', value: 'postgres://db', scope: 'runtime' },
      { key: 'VITE_HOST_URL', value: 'https://example.com', scope: 'build' },
      { key: 'PUBLIC_URL', value: 'https://example.com', scope: 'both' },
    ])
  })

  test('merges duplicate keys across compatible scopes', async () => {
    const inputs = await gatherAddInputs({
      repo: 'owner/blog',
      env: ['PUBLIC_URL=https://example.com'],
      'build-arg': ['PUBLIC_URL=https://example.com'],
    })

    expect(inputs.configEntries).toEqual([
      { key: 'PUBLIC_URL', value: 'https://example.com', scope: 'both' },
    ])
  })

  test('rejects conflicting duplicate values', async () => {
    await expect(
      gatherAddInputs({
        repo: 'owner/blog',
        env: ['PUBLIC_URL=https://app.example.com'],
        'build-arg': ['PUBLIC_URL=https://cdn.example.com'],
      }),
    ).rejects.toThrow('conflicting values for "PUBLIC_URL"')
  })
})
