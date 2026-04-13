import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Config } from '@jib/config'
import { getPaths, pathExists, repoPath } from '@jib/paths'
import { $ } from 'bun'
import {
  SourceDriverNotRegisteredError,
  SourceLocalCheckoutError,
  SourceLocalRepoError,
  SourceMissingAppError,
  SourceMissingConfigError,
  SourceProbeError,
  SourceRemoteResolveError,
  SourceRemoteSyncError,
} from './errors.ts'
import {
  sourcesCloneForInspection,
  sourcesProbe,
  sourcesRemoveCheckout,
  sourcesResolve,
  sourcesSync,
} from './index.ts'

const tempRoots: string[] = []

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

async function makeTempRoot(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix))
  tempRoots.push(dir)
  return dir
}

async function makeUpstream(name: string): Promise<string> {
  const dir = await makeTempRoot(`${name}-`)
  await $`git init -b main ${dir}`.quiet()
  await $`git -C ${dir} config user.email test@jib.local`.quiet()
  await $`git -C ${dir} config user.name test`.quiet()
  await writeFile(join(dir, 'README'), `${name}\n`)
  await $`git -C ${dir} add README`.quiet()
  await $`git -C ${dir} commit -m initial`.quiet()
  return dir
}

async function makeUpstreamOnBranch(name: string, branch: string): Promise<string> {
  const dir = await makeTempRoot(`${name}-`)
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

function expectSourceValue<T>(result: T | Error | null | undefined): T {
  if (result instanceof Error) throw result
  if (result == null) throw new Error('expected source result')
  return result
}

describe('sources service', () => {
  test('probe returns the remote sha without requiring a checkout', async () => {
    const upstream = await makeUpstream('jib-probe')
    const root = await makeTempRoot('jib-root-')
    const paths = getPaths(root)
    const result = expectSourceValue(
      await sourcesProbe(configFor(upstream), paths, { app: 'demo' }),
    )

    expect(result.sha).toMatch(/^[0-9a-f]{40}$/)
    expect(result.workdir).toBe(repoPath(paths, 'demo', upstream))
  })

  test('sourcesCloneForInspection and sourcesSync share the checkout lifecycle', async () => {
    const upstream = await makeUpstream('jib-roundtrip')
    const root = await makeTempRoot('jib-root-')
    const paths = getPaths(root)
    const workdir = repoPath(paths, 'demo', upstream)

    const checkout = expectSourceValue(
      await sourcesCloneForInspection(configFor(upstream), paths, { app: 'demo' }),
    )
    expect(checkout.workdir).toBe(workdir)

    const prepared = expectSourceValue(
      await sourcesSync(configFor(upstream), paths, { app: 'demo' }, 'main'),
    )
    expect(prepared.workdir).toBe(workdir)
    expect(await pathExists(workdir)).toBe(true)

    await sourcesRemoveCheckout(paths, 'demo', upstream)
    expect(await pathExists(workdir)).toBe(false)
  })

  test('probe and sourcesSync follow the remote default branch for a new app', async () => {
    const upstream = await makeUpstreamOnBranch('jib-master', 'master')
    const root = await makeTempRoot('jib-root-')
    const paths = getPaths(root)
    const cfg: Config = {
      config_version: 3,
      poll_interval: '5m',
      modules: {},
      sources: {},
      apps: {},
    }

    const probed = expectSourceValue(
      await sourcesProbe(cfg, paths, { app: 'demo', repo: upstream }),
    )
    const prepared = expectSourceValue(
      await sourcesSync(cfg, paths, { app: 'demo', repo: upstream }),
    )

    expect(probed.branch).toBe('master')
    expect(prepared.sha).toMatch(/^[0-9a-f]{40}$/)
  })

  test('sourcesSync accepts a tag ref', async () => {
    const upstream = await makeUpstream('jib-tag')
    await writeFile(join(upstream, 'RELEASE'), 'v2\n')
    await $`git -C ${upstream} add RELEASE`.quiet()
    await $`git -C ${upstream} commit -m release`.quiet()
    await $`git -C ${upstream} tag v2`.quiet()

    const root = await makeTempRoot('jib-root-')
    const paths = getPaths(root)
    const prepared = expectSourceValue(
      await sourcesSync(configFor(upstream), paths, { app: 'demo' }, 'v2'),
    )

    expect(prepared.sha).toMatch(/^[0-9a-f]{40}$/)
  })

  test('docker hub repo resolves to a stable local workdir without git', async () => {
    const root = await makeTempRoot('jib-root-')
    const paths = getPaths(root)
    const cfg: Config = {
      config_version: 3,
      poll_interval: '5m',
      modules: {},
      sources: {},
      apps: {},
    }

    const probed = await sourcesProbe(cfg, paths, {
      app: 'demo',
      repo: 'https://hub.docker.com/r/n8nio/n8n',
    })
    const prepared = expectSourceValue(
      await sourcesSync(cfg, paths, {
        app: 'demo',
        repo: 'https://hub.docker.com/r/n8nio/n8n',
      }),
    )

    expect(probed).toBeNull()
    expect(prepared.workdir).toBe(repoPath(paths, 'demo', 'local'))
    expect(prepared.sha).toBe('n8nio/n8n')
  })

  test('returns typed result errors for missing app and local repo resolution failures', async () => {
    const root = await makeTempRoot('jib-root-')
    const paths = getPaths(root)
    const cfg: Config = {
      config_version: 3,
      poll_interval: '5m',
      modules: {},
      sources: {},
      apps: {},
    }

    expect(await sourcesResolve(cfg, paths, { app: 'demo' })).toBeInstanceOf(SourceMissingAppError)
    expect(await sourcesResolve(cfg, paths, { app: 'demo', repo: 'local' })).toBeInstanceOf(
      SourceLocalRepoError,
    )
  })

  test('returns typed result errors for missing source config and driver registration', async () => {
    const root = await makeTempRoot('jib-root-')
    const paths = getPaths(root)

    const missingSourceCfg: Config = {
      config_version: 3,
      poll_interval: '5m',
      modules: {},
      sources: {},
      apps: {
        demo: {
          repo: 'acme/private',
          branch: 'main',
          domains: [],
          env_file: '.env',
          source: 'missing',
        },
      },
    }
    const missingDriverCfg: Config = {
      ...missingSourceCfg,
      sources: {
        missing: { driver: 'gitlab' as unknown as 'github', type: 'app', app_id: 1 },
      },
    }

    expect(await sourcesResolve(missingSourceCfg, paths, { app: 'demo' })).toBeInstanceOf(
      SourceMissingConfigError,
    )
    expect(await sourcesResolve(missingDriverCfg, paths, { app: 'demo' })).toBeInstanceOf(
      SourceDriverNotRegisteredError,
    )
  })

  test('returns a typed local checkout error for a missing local repo workdir', async () => {
    const root = await makeTempRoot('jib-root-')
    const paths = getPaths(root)
    const result = await sourcesSync(configFor('local'), paths, { app: 'demo' })

    expect(result).toBeInstanceOf(SourceLocalCheckoutError)
    expect(await sourcesProbe(configFor('local'), paths, { app: 'demo' })).toBeNull()
  })

  test('returns a typed remote resolve error when default branch lookup fails', async () => {
    const root = await makeTempRoot('jib-root-')
    const paths = getPaths(root)
    const cfg: Config = {
      config_version: 3,
      poll_interval: '5m',
      modules: {},
      sources: {},
      apps: {},
    }
    const result = await sourcesResolve(cfg, paths, {
      app: 'demo',
      repo: join(root, 'missing-upstream'),
    })

    expect(result).toBeInstanceOf(SourceRemoteResolveError)
  })

  test('returns a typed remote sync error when clone fails', async () => {
    const root = await makeTempRoot('jib-root-')
    const paths = getPaths(root)
    const missingRepo = join(root, 'missing-upstream')
    const result = await sourcesSync(configFor(join(root, 'missing-upstream')), paths, {
      app: 'demo',
    })

    expect(result).toBeInstanceOf(SourceRemoteSyncError)
    expect(await pathExists(repoPath(paths, 'demo', missingRepo))).toBe(false)
  })

  test('returns a typed probe error when lsRemote returns an error result', async () => {
    const upstream = await makeUpstream('jib-probe-fail')
    const root = await makeTempRoot('jib-root-')
    const paths = getPaths(root)
    const result = await sourcesProbe(
      configFor(upstream),
      paths,
      { app: 'demo' },
      {
        lsRemote: async () => new Error('permission denied'),
      },
    )

    expect(result).toBeInstanceOf(SourceProbeError)
  })
})
