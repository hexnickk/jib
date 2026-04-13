import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { chmod, mkdir, mkdtemp, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { EnsureCredsDirError, PathLookupError } from './errors.ts'
import {
  pathsCredsPath,
  pathsEnsureCredsDirResult,
  pathsGetPaths,
  pathsManagedComposePath,
  pathsPathExistsResult,
  pathsRepoPath,
} from './paths.ts'

const tempRoots: string[] = []

afterEach(async () => {
  while (tempRoots.length > 0) {
    const root = tempRoots.pop()
    if (root) await rm(root, { recursive: true, force: true })
  }
})

async function createTempRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'jib-paths-'))
  tempRoots.push(root)
  return root
}

describe('pathsGetPaths', () => {
  const prev = process.env.JIB_ROOT

  beforeEach(() => {
    process.env.JIB_ROOT = undefined
  })
  afterEach(() => {
    process.env.JIB_ROOT = prev
  })

  test('default root is /opt/jib', () => {
    const p = pathsGetPaths()
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
    expect(pathsGetPaths().root).toBe('/tmp/jib-test')
    expect(pathsGetPaths().configFile).toBe('/tmp/jib-test/config.yml')
  })

  test('explicit root wins over env', () => {
    process.env.JIB_ROOT = '/tmp/ignored'
    expect(pathsGetPaths('/srv/jib').root).toBe('/srv/jib')
  })
})

describe('pathsRepoPath', () => {
  const p = pathsGetPaths('/opt/jib')

  test('local repo', () => {
    expect(pathsRepoPath(p, 'myapp', 'local')).toBe('/opt/jib/repos/local/myapp')
  })
  test('empty repo treated as local', () => {
    expect(pathsRepoPath(p, 'myapp', '')).toBe('/opt/jib/repos/local/myapp')
  })
  test('github repo', () => {
    expect(pathsRepoPath(p, 'myapp', 'hexnickk/jib')).toBe('/opt/jib/repos/github/hexnickk/jib')
  })
})

describe('pathsCredsPath', () => {
  test('groups by kind and name', () => {
    const p = pathsGetPaths('/opt/jib')
    expect(pathsCredsPath(p, 'github-app', 'prod.pem')).toBe(
      '/opt/jib/secrets/_jib/github-app/prod.pem',
    )
  })
})

describe('pathsManagedComposePath', () => {
  test('uses a predictable jib-managed location', () => {
    const p = pathsGetPaths('/opt/jib')
    expect(pathsManagedComposePath(p, 'demo')).toBe('/opt/jib/compose/demo.yml')
  })
})

describe('pathsEnsureCredsDirResult', () => {
  test('creates group-writable setgid credential directories', async () => {
    const root = await createTempRoot()
    const p = pathsGetPaths(root)

    const dir = await pathsEnsureCredsDirResult(p, 'github-app')
    if (dir instanceof Error) throw dir
    const info = await stat(dir)

    expect(dir).toBe(join(root, 'secrets', '_jib', 'github-app'))
    expect(info.mode & 0o7777).toBe(0o2770)
  })

  test('returns typed errors when directory creation fails', async () => {
    const root = await createTempRoot()
    const p = pathsGetPaths(root)

    await writeFile(p.secretsDir, 'blocked')

    const result = await pathsEnsureCredsDirResult(p, 'github-app')

    expect(result).toBeInstanceOf(EnsureCredsDirError)
    if (result instanceof EnsureCredsDirError) {
      expect(result.cause).toBeInstanceOf(Error)
      expect(result.message).toContain('github-app')
    }
  })
})

describe('pathsPathExistsResult', () => {
  test('returns false for a missing path', async () => {
    const root = await createTempRoot()

    expect(await pathsPathExistsResult(join(root, 'missing'))).toBe(false)
  })

  test('returns false when a parent path is not a directory', async () => {
    const root = await createTempRoot()
    const file = join(root, 'file')

    await writeFile(file, 'blocked')

    expect(await pathsPathExistsResult(join(file, 'child'))).toBe(false)
  })

  test('returns typed errors for stat failures', async () => {
    const root = await createTempRoot()
    const parent = join(root, 'blocked')
    const target = join(parent, 'child')

    await mkdir(parent)
    await writeFile(target, 'secret')
    await chmod(parent, 0)

    try {
      const result = await pathsPathExistsResult(target)

      expect(result).toBeInstanceOf(PathLookupError)
      if (result instanceof PathLookupError) {
        expect(result.cause).toBeInstanceOf(Error)
      }
    } finally {
      await chmod(parent, 0o700)
    }
  })
})
