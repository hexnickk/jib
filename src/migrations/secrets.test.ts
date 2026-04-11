import { describe, expect, test } from 'bun:test'
import { chmod, mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { getPaths } from '@jib/paths'
import { repairManagedSecretsTree } from './secrets.ts'

describe('repairManagedSecretsTree', () => {
  test('restores managed secret directory modes without touching file contents', async () => {
    const root = await mkdtemp(join(tmpdir(), 'jib-secret-migration-'))
    try {
      const paths = getPaths(root)
      const baseDir = join(paths.secretsDir, '_jib')
      const appDir = join(baseDir, 'github-app')
      const pemPath = join(appDir, 'demo.pem')

      await mkdir(appDir, { recursive: true, mode: 0o750 })
      await chmod(baseDir, 0o2750)
      await chmod(appDir, 0o2750)
      await writeFile(pemPath, 'secret\n', { mode: 0o644 })

      await repairManagedSecretsTree(paths)

      expect((await stat(baseDir)).mode & 0o7777).toBe(0o2770)
      expect((await stat(appDir)).mode & 0o7777).toBe(0o2770)
      expect((await stat(pemPath)).mode & 0o777).toBe(0o640)
      expect(await readFile(pemPath, 'utf8')).toBe('secret\n')
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})
