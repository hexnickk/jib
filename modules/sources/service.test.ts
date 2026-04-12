import { describe, expect, test } from 'bun:test'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Config } from '@jib/config'
import { getPaths, pathExists, repoPath } from '@jib/paths'
import { $ } from 'bun'
import { cloneForInspection, probe, removeCheckout, resolve, syncApp } from './index.ts'
import { SourceLocalRepoError, SourceMissingAppError } from './service.ts'

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

async function makeUpstreamOnBranch(name: string, branch: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), `${name}-`))
  await $`git init -b ${branch} ${dir}`.quiet()
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
    sources: {},
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
  test('probe returns the remote sha without requiring a checkout', async () => {
    const upstream = await makeUpstream('jib-probe')
    const root = await mkdtemp(join(tmpdir(), 'jib-root-'))
    const paths = getPaths(root)
    const result = await probe(configFor(upstream), paths, { app: 'demo' })

    expect(result?.sha).toMatch(/^[0-9a-f]{40}$/)
    expect(result?.workdir).toBe(repoPath(paths, 'demo', upstream))
  })

  test('cloneForInspection and syncApp share the checkout lifecycle', async () => {
    const upstream = await makeUpstream('jib-roundtrip')
    const root = await mkdtemp(join(tmpdir(), 'jib-root-'))
    const paths = getPaths(root)
    const workdir = repoPath(paths, 'demo', upstream)

    const checkout = await cloneForInspection(configFor(upstream), paths, { app: 'demo' })
    expect(checkout.workdir).toBe(workdir)
    const prepared = await syncApp(configFor(upstream), paths, { app: 'demo' }, 'main')
    expect(prepared.workdir).toBe(workdir)
    expect(await pathExists(workdir)).toBe(true)

    await removeCheckout(paths, 'demo', upstream)
    expect(await pathExists(workdir)).toBe(false)
  })

  test('probe and syncApp follow the remote default branch for a new app', async () => {
    const upstream = await makeUpstreamOnBranch('jib-master', 'master')
    const root = await mkdtemp(join(tmpdir(), 'jib-root-'))
    const paths = getPaths(root)
    const cfg: Config = {
      config_version: 3,
      poll_interval: '5m',
      modules: {},
      sources: {},
      apps: {},
    }

    const probed = await probe(cfg, paths, { app: 'demo', repo: upstream })
    const prepared = await syncApp(cfg, paths, { app: 'demo', repo: upstream })

    expect(probed?.branch).toBe('master')
    expect(prepared.sha).toMatch(/^[0-9a-f]{40}$/)
  })

  test('syncApp accepts a tag ref', async () => {
    const upstream = await makeUpstream('jib-tag')
    await writeFile(join(upstream, 'RELEASE'), 'v2\n')
    await $`git -C ${upstream} add RELEASE`.quiet()
    await $`git -C ${upstream} commit -m release`.quiet()
    await $`git -C ${upstream} tag v2`.quiet()

    const root = await mkdtemp(join(tmpdir(), 'jib-root-'))
    const paths = getPaths(root)
    const prepared = await syncApp(configFor(upstream), paths, { app: 'demo' }, 'v2')

    expect(prepared.sha).toMatch(/^[0-9a-f]{40}$/)
  })

  test('docker hub repo resolves to a stable local workdir without git', async () => {
    const root = await mkdtemp(join(tmpdir(), 'jib-root-'))
    const paths = getPaths(root)
    const cfg: Config = {
      config_version: 3,
      poll_interval: '5m',
      modules: {},
      sources: {},
      apps: {},
    }

    const probed = await probe(cfg, paths, {
      app: 'demo',
      repo: 'https://hub.docker.com/r/n8nio/n8n',
    })
    const prepared = await syncApp(cfg, paths, {
      app: 'demo',
      repo: 'https://hub.docker.com/r/n8nio/n8n',
    })

    expect(probed).toBeNull()
    expect(prepared.workdir).toBe(repoPath(paths, 'demo', 'local'))
    expect(prepared.sha).toBe('n8nio/n8n')
  })

  test('returns typed errors for missing app and local repo resolution failures', async () => {
    const root = await mkdtemp(join(tmpdir(), 'jib-root-'))
    const paths = getPaths(root)
    const cfg: Config = {
      config_version: 3,
      poll_interval: '5m',
      modules: {},
      sources: {},
      apps: {},
    }

    await expect(resolve(cfg, paths, { app: 'demo' })).rejects.toBeInstanceOf(SourceMissingAppError)
    await expect(resolve(cfg, paths, { app: 'demo', repo: 'local' })).rejects.toBeInstanceOf(
      SourceLocalRepoError,
    )
  })
})
