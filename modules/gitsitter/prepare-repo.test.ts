import { describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Config } from '@jib/config'
import { getPaths, repoPath } from '@jib/core'
import { $ } from 'bun'
import { prepareRepo } from './handlers.ts'
import * as git from './src/git.ts'

async function makeUpstream(name: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), `${name}-`))
  await $`git init -b main ${dir}`.quiet()
  await $`git -C ${dir} config user.email test@jib.local`.quiet()
  await $`git -C ${dir} config user.name test`.quiet()
  await writeFile(join(dir, 'README'), `${name}\n`)
  await $`git -C ${dir} add README`.quiet()
  await $`git -C ${dir} commit -m initial`.quiet()
  return dir
}

function configFor(repo: string): Config {
  return {
    config_version: 3,
    poll_interval: '5m',
    modules: {},
    apps: {
      demo: {
        repo,
        branch: 'main',
        domains: [],
        env_file: '.env',
      },
    },
  }
}

describe('prepareRepo', () => {
  test('replaces an existing non-repo directory with a fresh clone', async () => {
    const upstream = await makeUpstream('jib-upstream')
    const root = await mkdtemp(join(tmpdir(), 'jib-root-'))
    const paths = getPaths(root)
    const cfg = configFor(upstream)
    const workdir = repoPath(paths, 'demo', upstream)

    await mkdir(workdir, { recursive: true })
    await writeFile(join(workdir, 'junk.txt'), 'stale\n')

    await prepareRepo(cfg, paths, { app: 'demo' }, 'main')

    expect(await git.isRepo(workdir)).toBe(true)
    expect(await git.currentSHA(workdir)).toMatch(/^[0-9a-f]{40}$/)
  })

  test('resets origin before fetching so stale remotes do not leak across retries', async () => {
    const upstream = await makeUpstream('jib-primary')
    const stale = await makeUpstream('jib-stale')
    const root = await mkdtemp(join(tmpdir(), 'jib-root-'))
    const paths = getPaths(root)
    const cfg = configFor(upstream)
    const workdir = repoPath(paths, 'demo', upstream)

    await $`git clone ${stale} ${workdir}`.quiet()
    await writeFile(join(upstream, 'NEW'), 'fresh\n')
    await $`git -C ${upstream} add NEW`.quiet()
    await $`git -C ${upstream} commit -m fresh`.quiet()

    const { sha } = await prepareRepo(cfg, paths, { app: 'demo' }, 'main')
    const remote = await $`git -C ${workdir} remote get-url origin`.quiet()

    expect(remote.stdout.toString().trim()).toBe(upstream)
    expect(await git.currentSHA(workdir)).toBe(sha)
  })
})
