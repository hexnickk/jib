import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdtemp, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { credsPath, ensureCredsDir, getPaths, managedComposePath, repoPath } from './paths.ts'

describe('getPaths', () => {
  const prev = process.env.JIB_ROOT

  beforeEach(() => {
    process.env.JIB_ROOT = undefined
  })
  afterEach(() => {
    process.env.JIB_ROOT = prev
  })

  test('default root is /opt/jib', () => {
    const p = getPaths()
    expect(p.root).toBe('/opt/jib')
    expect(p.configFile).toBe('/opt/jib/config.yml')
    expect(p.stateDir).toBe('/opt/jib/state')
    expect(p.locksDir).toBe('/opt/jib/locks')
    expect(p.secretsDir).toBe('/opt/jib/secrets')
    expect(p.overridesDir).toBe('/opt/jib/overrides')
    expect(p.composeDir).toBe('/opt/jib/compose')
    expect(p.reposDir).toBe('/opt/jib/repos')
    expect(p.repoRoot).toBe('/opt/jib/src')
    expect(p.nginxDir).toBe('/opt/jib/nginx')
    expect(p.cloudflaredDir).toBe('/opt/jib/cloudflared')
  })

  test('$JIB_ROOT overrides default', () => {
    process.env.JIB_ROOT = '/tmp/jib-test'
    expect(getPaths().root).toBe('/tmp/jib-test')
    expect(getPaths().configFile).toBe('/tmp/jib-test/config.yml')
  })

  test('explicit root wins over env', () => {
    process.env.JIB_ROOT = '/tmp/ignored'
    expect(getPaths('/srv/jib').root).toBe('/srv/jib')
  })
})

describe('repoPath', () => {
  const p = getPaths('/opt/jib')

  test('local repo', () => {
    expect(repoPath(p, 'myapp', 'local')).toBe('/opt/jib/repos/local/myapp')
  })
  test('empty repo treated as local', () => {
    expect(repoPath(p, 'myapp', '')).toBe('/opt/jib/repos/local/myapp')
  })
  test('github repo', () => {
    expect(repoPath(p, 'myapp', 'hexnickk/jib')).toBe('/opt/jib/repos/github/hexnickk/jib')
  })
})

describe('credsPath', () => {
  test('groups by kind and name', () => {
    const p = getPaths('/opt/jib')
    expect(credsPath(p, 'github-app', 'prod.pem')).toBe('/opt/jib/secrets/_jib/github-app/prod.pem')
  })
})

describe('managedComposePath', () => {
  test('uses a predictable jib-managed location', () => {
    const p = getPaths('/opt/jib')
    expect(managedComposePath(p, 'demo')).toBe('/opt/jib/compose/demo.yml')
  })
})

describe('ensureCredsDir', () => {
  test('creates group-writable setgid credential directories', async () => {
    const root = await mkdtemp(join(tmpdir(), 'jib-paths-'))
    const p = getPaths(root)

    const dir = await ensureCredsDir(p, 'github-app')
    const info = await stat(dir)

    expect(dir).toBe(join(root, 'secrets', '_jib', 'github-app'))
    expect(info.mode & 0o7777).toBe(0o2770)
  })
})
