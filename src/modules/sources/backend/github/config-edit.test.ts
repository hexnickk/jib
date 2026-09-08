import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { configLoad } from '@jib/config'
import { ValidationError } from '@jib/errors'
import { describe, expect, test } from 'vitest'
import {
  githubAddAppSource,
  githubAddKeySource,
  githubGetSource,
  githubValidateSourceName,
} from './config-edit.ts'

function expectLoadedConfig(result: Awaited<ReturnType<typeof configLoad>>) {
  if (result instanceof Error) {
    throw result
  }
  return result
}

async function seedConfig(opts: { withProviderRef?: boolean } = {}): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'jib-gh-'))
  const configFile = join(dir, 'config.yml')
  const sourceRef = opts.withProviderRef ? '    source: gh-key\n' : ''
  const sourceSection = opts.withProviderRef
    ? 'sources:\n  gh-key:\n    driver: github\n    type: key\n'
    : ''
  await writeFile(
    configFile,
    `config_version: 3
${sourceSection}apps:
  demo:
    repo: acme/demo
${sourceRef}    domains:
      - host: demo.example.com
        port: 3000
`,
  )
  return configFile
}

describe('config-edit', () => {
  test('round-trips a key source', async () => {
    const configFile = await seedConfig({ withProviderRef: true })
    const cfg = expectLoadedConfig(await configLoad(configFile))
    expect(githubGetSource(cfg, 'gh-key')).toEqual({ driver: 'github', type: 'key' })
    expect(githubValidateSourceName(cfg, 'gh-key')).toBeInstanceOf(ValidationError)
  })

  test('githubAddKeySource writes a new entry', async () => {
    const configFile = await seedConfig()
    expect(await githubAddKeySource(configFile, 'fresh')).toBeUndefined()
    const cfg = expectLoadedConfig(await configLoad(configFile))
    expect(githubGetSource(cfg, 'fresh')).toEqual({ driver: 'github', type: 'key' })
  })

  test('round-trips an app source', async () => {
    const configFile = await seedConfig()
    expect(await githubAddAppSource(configFile, 'gh-app', 42)).toBeUndefined()
    const cfg = expectLoadedConfig(await configLoad(configFile))
    expect(githubGetSource(cfg, 'gh-app')).toEqual({
      driver: 'github',
      type: 'app',
      app_id: 42,
    })
  })
})
