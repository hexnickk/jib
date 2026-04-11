import { describe, expect, test } from 'bun:test'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { loadConfig } from '@jib/config'
import {
  addGitHubAppSource,
  addGitHubKeySource,
  getGitHubSource,
  sourceNameAvailable,
} from './config-edit.ts'

async function seedConfig(opts: { withProviderRef?: boolean } = {}): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'jib-gh-'))
  const p = join(dir, 'config.yml')
  const sourceRef = opts.withProviderRef ? '    source: gh-key\n' : ''
  const sourceSection = opts.withProviderRef
    ? 'sources:\n  gh-key:\n    driver: github\n    type: key\n'
    : ''
  await writeFile(
    p,
    `config_version: 3
${sourceSection}apps:
  demo:
    repo: acme/demo
${sourceRef}    domains:
      - host: demo.example.com
        port: 3000
`,
  )
  return p
}

describe('config-edit', () => {
  test('round-trips a key source', async () => {
    const p = await seedConfig({ withProviderRef: true })
    const cfg = await loadConfig(p)
    expect(getGitHubSource(cfg, 'gh-key')).toEqual({ driver: 'github', type: 'key' })
    expect(() => sourceNameAvailable(cfg, 'gh-key')).toThrow(/already exists/)
  })

  test('addGitHubKeySource writes a new entry', async () => {
    const p = await seedConfig()
    await addGitHubKeySource(p, 'fresh')
    const cfg = await loadConfig(p)
    expect(getGitHubSource(cfg, 'fresh')).toEqual({ driver: 'github', type: 'key' })
  })

  test('round-trips an app source', async () => {
    const p = await seedConfig()
    await addGitHubAppSource(p, 'gh-app', 42)
    const cfg = await loadConfig(p)
    expect(getGitHubSource(cfg, 'gh-app')).toEqual({
      driver: 'github',
      type: 'app',
      app_id: 42,
    })
  })
})
