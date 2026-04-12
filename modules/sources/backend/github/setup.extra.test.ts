import { describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { getPaths } from '@jib/paths'
import { setupDeployKey, setupGitHubApp } from './setup.ts'

const noop = () => undefined

describe('github setup flows', () => {
  test('setupDeployKey adds the source and shows the generated public key', async () => {
    const notes: string[] = []
    const logs: string[] = []
    const root = await mkdtemp(join(tmpdir(), 'jib-gh-setup-'))
    const paths = getPaths(root)
    const uiLog = {
      message: noop,
      info: (message: string) => {
        logs.push(`info:${message}`)
      },
      success: (message: string) => {
        logs.push(`success:${message}`)
      },
      step: noop,
      warn: noop,
      warning: (message: string) => {
        logs.push(`warning:${message}`)
      },
      error: noop,
    }

    const result = await setupDeployKey(
      { config: {} as never, logger: {} as never, paths },
      {
        loadConfig: async () => ({
          config_version: 3,
          poll_interval: '5m',
          modules: {},
          sources: {},
          apps: {},
        }),
        log: uiLog,
        note: (message = '') => notes.push(message),
        promptString: async () => 'demo-key',
        sourceNameAvailable: () => undefined,
        addGitHubKeySource: async (_configFile: string, name: string) => {
          logs.push(`added:${name}`)
        },
        generateDeployKey: async () => 'ssh-ed25519 AAAA test',
      },
    )

    expect(result).toBe('demo-key')
    expect(logs).toContain('added:demo-key')
    expect(notes[0]).toContain('ssh-ed25519 AAAA test')
    await rm(root, { recursive: true, force: true })
  })

  test('setupGitHubApp writes the PEM and adds the app source', async () => {
    const root = await mkdtemp(join(tmpdir(), 'jib-gh-app-'))
    const paths = getPaths(root)
    const writes: string[] = []
    const uiLog = {
      message: noop,
      info: noop,
      success: (message: string) => {
        writes.push(`success:${message}`)
      },
      step: noop,
      warn: noop,
      warning: noop,
      error: noop,
    }

    const result = await setupGitHubApp(
      { config: {} as never, logger: {} as never, paths },
      {
        loadConfig: async () => ({
          config_version: 3,
          poll_interval: '5m',
          modules: {},
          sources: {},
          apps: {},
        }),
        log: uiLog,
        promptString: async () => 'demo-app',
        promptInt: async () => 123,
        promptPEM: async () => 'PRIVATE KEY',
        sourceNameAvailable: () => undefined,
        ensureCredsDir: async () => {
          const dir = join(paths.secretsDir, '_jib', 'github-app')
          await mkdir(dir, { recursive: true })
          return dir
        },
        addGitHubAppSource: async (_configFile: string, name: string, appId: number) => {
          writes.push(`source:${name}:${appId}`)
        },
      },
    )

    expect(result).toBe('demo-app')
    expect(
      await readFile(join(paths.secretsDir, '_jib', 'github-app', 'demo-app.pem'), 'utf8'),
    ).toBe('PRIVATE KEY')
    expect(writes).toContain('source:demo-app:123')
    await rm(root, { recursive: true, force: true })
  })
})
