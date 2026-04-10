import { describe, expect, test } from 'bun:test'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Config } from '@jib/config'
import { getPaths, pathExists, repoPath } from '@jib/core'
import { $ } from 'bun'
import { cloneForInspection, probe, removeCheckout, syncApp } from './index.ts'

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
})
