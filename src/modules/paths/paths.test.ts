import { chmod, mkdir, mkdtemp, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { InternalError } from '@jib/errors'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
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
    if (root) {
      await rm(root, { recursive: true, force: true })
    }
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
    Reflect.deleteProperty(process.env, 'JIB_ROOT')
  })
  afterEach(() => {
    if (prev === undefined) {
      Reflect.deleteProperty(process.env, 'JIB_ROOT')
    } else {
      process.env.JIB_ROOT = prev
    }
  })

  test('default root is /opt/jib', () => {
    const paths = pathsGetPaths()
    expect(paths.root).toBe('/opt/jib')
    expect(paths.configFile).toBe('/opt/jib/config.yml')
    expect(paths.stateDir).toBe('/opt/jib/state')
    expect(paths.locksDir).toBe('/opt/jib/locks')
    expect(paths.secretsDir).toBe('/opt/jib/secrets')
    expect(paths.overridesDir).toBe('/opt/jib/overrides')
    expect(paths.composeDir).toBe('/opt/jib/compose')
    expect(paths.reposDir).toBe('/opt/jib/repos')
    expect(paths.repoRoot).toBe('/opt/jib/src')
    expect(paths.nginxDir).toBe('/opt/jib/nginx')
    expect(paths.cloudflaredDir).toBe('/opt/jib/cloudflared')
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
  const paths = pathsGetPaths('/opt/jib')

  test('local repo', () => {
    expect(pathsRepoPath(paths, 'myapp', 'local')).toBe('/opt/jib/repos/local/myapp')
  })
  test('empty repo treated as local', () => {
    expect(pathsRepoPath(paths, 'myapp', '')).toBe('/opt/jib/repos/local/myapp')
  })
  test('github repo', () => {
    expect(pathsRepoPath(paths, 'myapp', 'hexnickk/jib')).toBe('/opt/jib/repos/github/hexnickk/jib')
  })
})

describe('pathsCredsPath', () => {
  test('groups by kind and name', () => {
    const paths = pathsGetPaths('/opt/jib')
    expect(pathsCredsPath(paths, 'github-app', 'prod.pem')).toBe(
      '/opt/jib/secrets/_jib/github-app/prod.pem',
    )
  })
})

describe('pathsManagedComposePath', () => {
  test('uses a predictable jib-managed location', () => {
    const paths = pathsGetPaths('/opt/jib')
    expect(pathsManagedComposePath(paths, 'demo')).toBe('/opt/jib/compose/demo.yml')
  })
})

describe('pathsEnsureCredsDirResult', () => {
  test('creates group-writable setgid credential directories', async () => {
    const root = await createTempRoot()
    const paths = pathsGetPaths(root)

    const dir = await pathsEnsureCredsDirResult(paths, 'github-app')
    if (dir instanceof Error) {
      throw dir
    }
    const info = await stat(dir)

    expect(dir).toBe(join(root, 'secrets', '_jib', 'github-app'))
    expect(info.mode & 0o7777).toBe(0o2770)
  })

  test('returns typed errors when directory creation fails', async () => {
    const root = await createTempRoot()
    const paths = pathsGetPaths(root)

    await writeFile(paths.secretsDir, 'blocked')

    const result = await pathsEnsureCredsDirResult(paths, 'github-app')

    expect(result).toBeInstanceOf(InternalError)
    if (result instanceof InternalError) {
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

      expect(result).toBeInstanceOf(InternalError)
      if (result instanceof InternalError) {
        expect(result.cause).toBeInstanceOf(Error)
      }
    } finally {
      await chmod(parent, 0o700)
    }
  })
})
