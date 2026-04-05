import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { credsPath, getPaths, repoPath } from './paths.ts'

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
    expect(p.reposDir).toBe('/opt/jib/repos')
    expect(p.nginxDir).toBe('/opt/jib/nginx')
    expect(p.busDir).toBe('/opt/jib/bus')
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
