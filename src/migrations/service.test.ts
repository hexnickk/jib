import { describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathsGetPaths } from '@jib/paths'
import { hasBootstrapState, userInGroup } from './service.ts'

describe('hasBootstrapState', () => {
  test('returns false when config exists without migration state', async () => {
    const root = await mkdtemp(join(tmpdir(), 'jib-bootstrap-state-'))
    try {
      const paths = pathsGetPaths(root)
      await writeFile(paths.configFile, 'config_version: 3\n')
      expect(hasBootstrapState(paths)).toBe(false)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  test('returns true when config and state db both exist', async () => {
    const root = await mkdtemp(join(tmpdir(), 'jib-bootstrap-state-'))
    try {
      const paths = pathsGetPaths(root)
      await mkdir(paths.stateDir, { recursive: true })
      await writeFile(paths.configFile, 'config_version: 3\n')
      await writeFile(join(paths.stateDir, 'jib.db'), '')
      expect(hasBootstrapState(paths)).toBe(true)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})

describe('userInGroup', () => {
  test('returns true when the target group is present', () => {
    expect(
      userInGroup('demo', 'jib', {
        run: () => ({ exitCode: 0, stdout: { toString: () => 'wheel jib docker\n' } }),
      }),
    ).toBe(true)
  })

  test('returns false when the target group is absent or lookup fails', () => {
    expect(
      userInGroup('demo', 'jib', {
        run: () => ({ exitCode: 0, stdout: { toString: () => 'wheel docker\n' } }),
      }),
    ).toBe(false)
    expect(
      userInGroup('demo', 'jib', {
        run: () => ({ exitCode: 1, stdout: { toString: () => '' } }),
      }),
    ).toBe(false)
  })
})
