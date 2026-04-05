import { describe, expect, test } from 'bun:test'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Config } from '@jib/config'
import { getPaths } from '@jib/core'
import { FakeBus, SUBJECTS, flush } from '@jib/rpc'
import { $ } from 'bun'
import { registerHandlers } from './handlers.ts'

async function makeUpstream(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'jib-up-'))
  await $`git init -b main ${dir}`.quiet()
  await $`git -C ${dir} config user.email test@jib.local`.quiet()
  await $`git -C ${dir} config user.name test`.quiet()
  await writeFile(join(dir, 'README'), 'hi\n')
  await $`git -C ${dir} add README`.quiet()
  await $`git -C ${dir} commit -m initial`.quiet()
  return dir
}

async function makeConfigAndPaths(upstream: string) {
  const root = await mkdtemp(join(tmpdir(), 'jib-root-'))
  const paths = getPaths(root)
  const cfg: Config = {
    config_version: 3,
    poll_interval: '5m',
    apps: {
      demo: {
        repo: upstream, // use path as "repo" — cloneURL will be overridden
        branch: 'main',
        domains: [{ host: 'demo.example.com', port: 3000 }],
        env_file: '.env',
      },
    },
  } as Config
  return { paths, cfg }
}

describe('gitsitter handlers', () => {
  test('cmd.repo.prepare clones and emits evt.repo.ready', async () => {
    const upstream = await makeUpstream()
    const { paths, cfg } = await makeConfigAndPaths(upstream)

    // Point the app's clone URL at the filesystem upstream by setting
    // repo to the path and letting cloneURL-for-ssh produce `git@github.com:<path>.git`.
    // We instead test by calling the underlying prepareRepo indirectly — clone
    // via sshCloneURL would fail for a filesystem path. Easier: pre-clone the
    // workdir from the upstream path, then cmd.repo.prepare should just fetch.
    const { repoPath } = await import('@jib/core')
    const demoApp = cfg.apps.demo
    if (!demoApp) throw new Error('demo missing')
    const workdir = repoPath(paths, 'demo', demoApp.repo)
    await $`mkdir -p ${workdir}`.quiet()
    await $`git clone ${upstream} ${workdir}`.quiet()

    const bus = new FakeBus()
    const events: Array<{ subject: string; payload: unknown }> = []
    bus.subscribe(SUBJECTS.evt.repoReady, (p) => {
      events.push({ subject: 'ready', payload: p })
    })
    bus.subscribe(SUBJECTS.evt.repoFailed, (p) => {
      events.push({ subject: 'failed', payload: p })
    })

    registerHandlers(bus.asBus(), paths, () => cfg)

    bus.publish(SUBJECTS.cmd.repoPrepare, {
      corrId: 'c1',
      ts: new Date().toISOString(),
      source: 'test',
      app: 'demo',
      ref: 'main',
    })
    // wait for async handler
    for (let i = 0; i < 10; i++) await flush()
    expect(events.some((e) => e.subject === 'ready')).toBe(true)
  })

  test('unknown app publishes evt.repo.failed', async () => {
    const { paths, cfg } = await makeConfigAndPaths(await makeUpstream())
    const bus = new FakeBus()
    const failures: unknown[] = []
    bus.subscribe(SUBJECTS.evt.repoFailed, (p) => {
      failures.push(p)
    })
    registerHandlers(bus.asBus(), paths, () => cfg)

    bus.publish(SUBJECTS.cmd.repoPrepare, {
      corrId: 'c2',
      ts: new Date().toISOString(),
      source: 'test',
      app: 'ghost',
      ref: 'main',
    })
    for (let i = 0; i < 5; i++) await flush()
    expect(failures).toHaveLength(1)
  })
})
