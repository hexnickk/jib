import { describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { getPaths } from '@jib/core'
import { hasBootstrapState } from './service.ts'

describe('hasBootstrapState', () => {
  test('returns false when config exists without migration state', async () => {
    const root = await mkdtemp(join(tmpdir(), 'jib-bootstrap-state-'))
    try {
      const paths = getPaths(root)
      await writeFile(paths.configFile, 'config_version: 3\n')
      expect(hasBootstrapState(paths)).toBe(false)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  test('returns true when config and state db both exist', async () => {
    const root = await mkdtemp(join(tmpdir(), 'jib-bootstrap-state-'))
    try {
      const paths = getPaths(root)
      await mkdir(paths.stateDir, { recursive: true })
      await writeFile(paths.configFile, 'config_version: 3\n')
      await writeFile(join(paths.stateDir, 'jib.db'), '')
      expect(hasBootstrapState(paths)).toBe(true)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})
