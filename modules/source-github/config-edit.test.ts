import { describe, expect, test } from 'bun:test'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { loadConfig } from '@jib/config'
import {
  addAppProvider,
  addKeyProvider,
  appsUsingProvider,
  getProvider,
  providerNameAvailable,
  removeProvider,
} from './config-edit.ts'

async function seedConfig(opts: { withProviderRef?: boolean } = {}): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'jib-gh-'))
  const p = join(dir, 'config.yml')
  const providerRef = opts.withProviderRef ? '    provider: gh-key\n' : ''
  const providerSection = opts.withProviderRef
    ? 'github:\n  providers:\n    gh-key:\n      type: key\n'
    : ''
  await writeFile(
    p,
    `config_version: 3
${providerSection}apps:
  demo:
    repo: acme/demo
${providerRef}    domains:
      - host: demo.example.com
        port: 3000
`,
  )
  return p
}

describe('config-edit', () => {
  test('round-trips a key provider', async () => {
    const p = await seedConfig({ withProviderRef: true })
    const cfg = await loadConfig(p)
    expect(getProvider(cfg, 'gh-key')).toEqual({ type: 'key' })
    expect(() => providerNameAvailable(cfg, 'gh-key')).toThrow(/already exists/)
    expect(appsUsingProvider(cfg, 'gh-key')).toEqual(['demo'])
  })

  test('addKeyProvider writes a new entry', async () => {
    const p = await seedConfig()
    await addKeyProvider(p, 'fresh')
    const cfg = await loadConfig(p)
    expect(getProvider(cfg, 'fresh')).toEqual({ type: 'key' })
  })

  test('round-trips an app provider and removes it cleanly', async () => {
    const p = await seedConfig()
    await addAppProvider(p, 'gh-app', 42)
    let cfg = await loadConfig(p)
    expect(getProvider(cfg, 'gh-app')).toEqual({ type: 'app', app_id: 42 })

    await removeProvider(p, 'gh-app')
    cfg = await loadConfig(p)
    expect(getProvider(cfg, 'gh-app')).toBeUndefined()
    // github section is dropped when it has no providers left
    expect(cfg.github).toBeUndefined()
  })
})
