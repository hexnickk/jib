import { describe, expect, test } from 'bun:test'
import type { promptSelect } from '@jib/tui'
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

  test('prompts for persist paths for docker hub repos in interactive mode', async () => {
    const inputs = await gatherAddInputs(
      { repo: 'https://hub.docker.com/r/n8nio/n8n' },
      {
        isInteractive: () => true,
        promptStringOptional: async () => '/home/node/.n8n,/files',
      },
    )

    expect(inputs.persistPaths).toEqual(['/home/node/.n8n', '/files'])
  })

  test('normalizes docker hub owner-name shorthand when backend is dockerhub', async () => {
    const inputs = await gatherAddInputs(
      { repo: 'n8nio/n8n', backend: 'dockerhub' },
      { isInteractive: () => false },
    )

    expect(inputs.repo).toBe('docker://n8nio/n8n')
  })

  test('prompts for backend before repo in interactive mode', async () => {
    const prompts: string[] = []
    const inputs = await gatherAddInputs(
      {},
      {
        isInteractive: () => true,
        promptSelect: (async <T extends string>() => 'dockerhub' as T) as typeof promptSelect,
        promptString: async (opts) => {
          prompts.push(opts.message)
          return 'n8nio/n8n'
        },
        promptStringOptional: async () => '/home/node/.n8n',
      },
    )

    expect(prompts[0]).toBe('Docker Hub image (owner/name or URL)')
    expect(inputs.repo).toBe('docker://n8nio/n8n')
    expect(inputs.persistPaths).toEqual(['/home/node/.n8n'])
  })

  test('normalizes github URLs when backend is github', async () => {
    const inputs = await gatherAddInputs(
      {
        repo: 'https://github.com/hexnickk/blog',
        backend: 'github',
      },
      { isInteractive: () => false },
    )

    expect(inputs.repo).toBe('hexnickk/blog')
  })
})
