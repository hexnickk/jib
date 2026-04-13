import { describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { sourcesEnsureCheckout } from './checkout.ts'
import { sourcesGitHasRemote, sourcesGitIsRepo } from './git.ts'

describe('sourcesEnsureCheckout', () => {
  test('reclones when an existing workdir is not a git repo', async () => {
    const upstream = await mkdtemp(join(tmpdir(), 'jib-sources-upstream-'))
    const workdirRoot = await mkdtemp(join(tmpdir(), 'jib-sources-workdir-'))
    const workdir = join(workdirRoot, 'demo')

    try {
      await Bun.$`git init -b main ${upstream}`.quiet()
      await Bun.$`git -C ${upstream} config user.email test@jib.local`.quiet()
      await Bun.$`git -C ${upstream} config user.name test`.quiet()
      await writeFile(join(upstream, 'README.md'), 'upstream\n')
      await Bun.$`git -C ${upstream} add README.md`.quiet()
      await Bun.$`git -C ${upstream} commit -m initial`.quiet()

      await mkdir(workdir, { recursive: true })
      await writeFile(join(workdir, 'README.md'), 'stale checkout\n')

      expect(await sourcesEnsureCheckout(workdir, upstream, 'main', {})).toBeUndefined()
      expect(await sourcesGitIsRepo(workdir)).toBe(true)
      expect(await sourcesGitHasRemote(workdir)).toBe(true)
    } finally {
      await rm(upstream, { recursive: true, force: true })
      await rm(workdirRoot, { recursive: true, force: true })
    }
  })
})
