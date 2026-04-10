import { describe, expect, test } from 'bun:test'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Config } from '@jib/config'
import { getPaths, pathExists, repoPath } from '@jib/core'
import { $ } from 'bun'
import { prepareSource, probeSource, removeSource } from './index.ts'

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

describe('sources service', () => {
  test('probeSource returns the remote sha without requiring a checkout', async () => {
    const upstream = await makeUpstream('jib-probe')
    const root = await mkdtemp(join(tmpdir(), 'jib-root-'))
    const paths = getPaths(root)
    const probe = await probeSource(configFor(upstream), paths, { app: 'demo' })

    expect(probe?.sha).toMatch(/^[0-9a-f]{40}$/)
    expect(probe?.workdir).toBe(repoPath(paths, 'demo', upstream))
  })

  test('prepareSource creates a checkout that removeSource can clean up', async () => {
    const upstream = await makeUpstream('jib-roundtrip')
    const root = await mkdtemp(join(tmpdir(), 'jib-root-'))
    const paths = getPaths(root)
    const workdir = repoPath(paths, 'demo', upstream)

    const prepared = await prepareSource(configFor(upstream), paths, { app: 'demo' }, 'main')
    expect(prepared.workdir).toBe(workdir)
    expect(await pathExists(workdir)).toBe(true)

    await removeSource(paths, 'demo', upstream)
    expect(await pathExists(workdir)).toBe(false)
  })
})
