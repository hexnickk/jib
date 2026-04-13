import { describe, expect, test } from 'bun:test'
import type { tuiPromptSelectResult } from '@jib/tui'
import { addGatherInputs } from './inputs.ts'

describe('addGatherInputs', () => {
  test('parses runtime, build, and shared config entries', async () => {
    const inputs = await addGatherInputs({
      repo: 'owner/blog',
      env: ['DATABASE_URL=postgres://db'],
      'build-arg': ['VITE_HOST_URL=https://example.com'],
      'build-env': ['PUBLIC_URL=https://example.com'],
    })
    if (inputs instanceof Error) throw inputs

    expect(inputs.configEntries).toEqual([
      { key: 'DATABASE_URL', value: 'postgres://db', scope: 'runtime' },
      { key: 'VITE_HOST_URL', value: 'https://example.com', scope: 'build' },
      { key: 'PUBLIC_URL', value: 'https://example.com', scope: 'both' },
    ])
  })

  test('merges duplicate keys across compatible scopes', async () => {
    const inputs = await addGatherInputs({
      repo: 'owner/blog',
      env: ['PUBLIC_URL=https://example.com'],
      'build-arg': ['PUBLIC_URL=https://example.com'],
    })
    if (inputs instanceof Error) throw inputs

    expect(inputs.configEntries).toEqual([
      { key: 'PUBLIC_URL', value: 'https://example.com', scope: 'both' },
    ])
  })

  test('rejects conflicting duplicate values', async () => {
    const result = await addGatherInputs({
      repo: 'owner/blog',
      env: ['PUBLIC_URL=https://app.example.com'],
      'build-arg': ['PUBLIC_URL=https://cdn.example.com'],
    })

    expect(result).toBeInstanceOf(Error)
    expect((result as Error).message).toContain('conflicting values for "PUBLIC_URL"')
  })

  test('prompts for persist paths for docker hub repos in interactive mode', async () => {
    const inputs = await addGatherInputs(
      { repo: 'https://hub.docker.com/r/n8nio/n8n' },
      {
        isInteractive: () => true,
        promptStringOptional: async () => '/home/node/.n8n,/files',
      },
    )
    if (inputs instanceof Error) throw inputs

    expect(inputs.persistPaths).toEqual(['/home/node/.n8n', '/files'])
  })

  test('normalizes docker hub owner-name shorthand when backend is dockerhub', async () => {
    const inputs = await addGatherInputs(
      { repo: 'n8nio/n8n', backend: 'dockerhub' },
      { isInteractive: () => false },
    )
    if (inputs instanceof Error) throw inputs

    expect(inputs.repo).toBe('docker://n8nio/n8n')
  })

  test('prompts for backend before repo in interactive mode', async () => {
    const prompts: string[] = []
    const inputs = await addGatherInputs(
      {},
      {
        isInteractive: () => true,
        promptSelect: (async <T extends string>(_opts: {
          message: string
          options: { value: T; label: string; hint?: string }[]
          initialValue?: T
        }) => 'dockerhub' as T) as typeof tuiPromptSelectResult,
        promptString: async (opts) => {
          prompts.push(opts.message)
          return 'n8nio/n8n'
        },
        promptStringOptional: async () => '/home/node/.n8n',
      },
    )
    if (inputs instanceof Error) throw inputs

    expect(prompts[0]).toBe('Docker Hub image (owner/name or URL)')
    expect(inputs.repo).toBe('docker://n8nio/n8n')
    expect(inputs.persistPaths).toEqual(['/home/node/.n8n'])
  })

  test('normalizes github URLs when backend is github', async () => {
    const inputs = await addGatherInputs(
      {
        repo: 'https://github.com/hexnickk/blog',
        backend: 'github',
      },
      { isInteractive: () => false },
    )
    if (inputs instanceof Error) throw inputs

    expect(inputs.repo).toBe('hexnickk/blog')
  })
})
