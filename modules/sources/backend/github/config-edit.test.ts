import { describe, expect, test } from 'bun:test'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ConfigError, configLoad } from '@jib/config'
import {
  GitHubSourceAlreadyExistsError,
  githubAddAppSource,
  githubAddKeySource,
  githubGetSource,
  githubValidateSourceName,
} from './config-edit.ts'

function expectLoadedConfig(result: Awaited<ReturnType<typeof configLoad>>) {
  if (result instanceof ConfigError) throw result
  return result
}

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
    const cfg = expectLoadedConfig(await configLoad(p))
    expect(githubGetSource(cfg, 'gh-key')).toEqual({ driver: 'github', type: 'key' })
    expect(githubValidateSourceName(cfg, 'gh-key')).toBeInstanceOf(GitHubSourceAlreadyExistsError)
  })

  test('githubAddKeySource writes a new entry', async () => {
    const p = await seedConfig()
    expect(await githubAddKeySource(p, 'fresh')).toBeUndefined()
    const cfg = expectLoadedConfig(await configLoad(p))
    expect(githubGetSource(cfg, 'fresh')).toEqual({ driver: 'github', type: 'key' })
  })

  test('round-trips an app source', async () => {
    const p = await seedConfig()
    expect(await githubAddAppSource(p, 'gh-app', 42)).toBeUndefined()
    const cfg = expectLoadedConfig(await configLoad(p))
    expect(githubGetSource(cfg, 'gh-app')).toEqual({
      driver: 'github',
      type: 'app',
      app_id: 42,
    })
  })
})
