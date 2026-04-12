import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { getPaths } from '@jib/paths'

beforeEach(() => {
  mock.restore()
})

afterEach(() => {
  mock.restore()
})

describe('github setup flows', () => {
  test('setupDeployKey adds the source and shows the generated public key', async () => {
    const notes: string[] = []
    const logs: string[] = []
    const root = await mkdtemp(join(tmpdir(), 'jib-gh-setup-'))
    const paths = getPaths(root)

    mock.module('@jib/config', () => ({
      loadConfig: async () => ({
        config_version: 3,
        poll_interval: '5m',
        modules: {},
        sources: {},
        apps: {},
      }),
    }))
    mock.module('@jib/tui', () => ({
      log: {
        success: (message: string) => logs.push(`success:${message}`),
        warning: (message: string) => logs.push(`warning:${message}`),
        info: (message: string) => logs.push(`info:${message}`),
      },
      note: (message: string) => notes.push(message),
      promptInt: async () => 1,
      promptPEM: async () => 'pem',
      promptSelect: async () => 'skip',
      promptString: async () => 'demo-key',
    }))
    mock.module('./config-edit.ts', () => ({
      addGitHubAppSource: async () => undefined,
      addGitHubKeySource: async (_configFile: string, name: string) => {
        logs.push(`added:${name}`)
      },
      sourceNameAvailable: () => undefined,
    }))
    mock.module('./keygen.ts', () => ({
      deployKeyPaths: () => ({ privateKey: '/tmp/demo-key', publicKey: '/tmp/demo-key.pub' }),
      generateDeployKey: async () => 'ssh-ed25519 AAAA test',
    }))

    const { setupDeployKey } = await import('./setup.ts')
    const result = await setupDeployKey({ config: {} as never, logger: {} as never, paths })

    expect(result).toBe('demo-key')
    expect(logs).toContain('added:demo-key')
    expect(notes[0]).toContain('ssh-ed25519 AAAA test')
    await rm(root, { recursive: true, force: true })
  })

  test('setupGitHubApp writes the PEM and adds the app source', async () => {
    const root = await mkdtemp(join(tmpdir(), 'jib-gh-app-'))
    const paths = getPaths(root)
    const writes: string[] = []

    mock.module('@jib/config', () => ({
      loadConfig: async () => ({
        config_version: 3,
        poll_interval: '5m',
        modules: {},
        sources: {},
        apps: {},
      }),
    }))
    mock.module('@jib/tui', () => ({
      log: {
        success: (message: string) => writes.push(`success:${message}`),
        warning: () => undefined,
        info: () => undefined,
      },
      note: () => undefined,
      promptInt: async () => 123,
      promptPEM: async () => 'PRIVATE KEY',
      promptSelect: async () => 'skip',
      promptString: async () => 'demo-app',
    }))
    mock.module('./config-edit.ts', () => ({
      addGitHubAppSource: async (_configFile: string, name: string, appId: number) => {
        writes.push(`source:${name}:${appId}`)
      },
      addGitHubKeySource: async () => undefined,
      sourceNameAvailable: () => undefined,
    }))

    const { setupGitHubApp } = await import('./setup.ts')
    const result = await setupGitHubApp({ config: {} as never, logger: {} as never, paths })

    expect(result).toBe('demo-app')
    expect(
      await readFile(join(paths.secretsDir, '_jib', 'github-app', 'demo-app.pem'), 'utf8'),
    ).toBe('PRIVATE KEY')
    expect(writes).toContain('source:demo-app:123')
    await rm(root, { recursive: true, force: true })
  })
})
