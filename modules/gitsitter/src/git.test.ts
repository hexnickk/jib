import { describe, expect, test } from 'bun:test'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { $ } from 'bun'
import * as git from './git.ts'

async function makeUpstream(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'jib-git-'))
  await $`git init -b main ${dir}`.quiet()
  await $`git -C ${dir} config user.email test@jib.local`.quiet()
  await $`git -C ${dir} config user.name test`.quiet()
  await writeFile(join(dir, 'README'), 'initial\n')
  await $`git -C ${dir} add README`.quiet()
  await $`git -C ${dir} commit -m initial`.quiet()
  return dir
}

describe('git (smoke)', () => {
  test('clone + currentSHA round-trip', async () => {
    const upstream = await makeUpstream()
    const work = await mkdtemp(join(tmpdir(), 'jib-clone-'))
    await git.clone(upstream, join(work, 'repo'))
    expect(await git.isRepo(join(work, 'repo'))).toBe(true)
    const sha = await git.currentSHA(join(work, 'repo'))
    expect(sha).toMatch(/^[0-9a-f]{40}$/)
  })

  test('fetch + remoteSHA + checkout detects new commits', async () => {
    const upstream = await makeUpstream()
    const work = await mkdtemp(join(tmpdir(), 'jib-clone2-'))
    const repo = join(work, 'repo')
    await git.clone(upstream, repo, { branch: 'main' })

    // Add a second commit upstream.
    await writeFile(join(upstream, 'NEW'), 'x\n')
    await $`git -C ${upstream} add NEW`.quiet()
    await $`git -C ${upstream} commit -m second`.quiet()

    await git.fetch(repo, 'main')
    const remote = await git.remoteSHA(repo, 'main')
    await git.checkout(repo, remote)
    expect(await git.currentSHA(repo)).toBe(remote)
  })

  test('configureSSHKey builds a GIT_SSH_COMMAND', () => {
    const env = git.configureSSHKey('/tmp/key')
    expect(env.GIT_SSH_COMMAND).toContain('/tmp/key')
    expect(env.GIT_SSH_COMMAND).toContain('StrictHostKeyChecking=accept-new')
  })
})
