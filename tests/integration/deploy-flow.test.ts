import { describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Config } from '@jib/config'
import { createLogger, getPaths, repoPath } from '@jib/core'
import type { DockerExec, ExecResult } from '@jib/docker'
import { FakeBus, SUBJECTS, flush } from '@jib/rpc'
import { Store } from '@jib/state'
import { $ } from 'bun'
import { Engine } from '../../modules/deployer/engine.ts'
import { registerDeployerHandlers } from '../../modules/deployer/handlers.ts'
import { registerHandlers as registerGitsitter } from '../../modules/gitsitter/handlers.ts'

/**
 * End-to-end event flow without NATS or real docker. Exercises:
 *   gitsitter.cmd.repo.prepare → evt.repo.ready → deployer.cmd.deploy → evt.deploy.success
 *
 * The gitsitter handler wants to clone/fetch from the configured repo URL;
 * we sidestep network by pre-cloning into the expected workdir from a local
 * tmpdir "upstream" so fetch+checkout run against a real origin.
 */

async function mkUpstream(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'jib-int-up-'))
  await $`git init -b main ${dir}`.quiet()
  await $`git -C ${dir} config user.email test@jib.local`.quiet()
  await $`git -C ${dir} config user.name test`.quiet()
  await writeFile(join(dir, 'docker-compose.yml'), 'services:\n  web:\n    image: nginx\n')
  await $`git -C ${dir} add docker-compose.yml`.quiet()
  await $`git -C ${dir} commit -m initial`.quiet()
  return dir
}

describe('deploy-flow integration', () => {
  test('repo.prepare → repo.ready → deploy → deploy.success', async () => {
    const upstream = await mkUpstream()
    const root = await mkdtemp(join(tmpdir(), 'jib-int-root-'))
    await mkdir(join(root, 'locks'), { recursive: true })
    await mkdir(join(root, 'state'), { recursive: true })
    const paths = getPaths(root)

    const cfg: Config = {
      config_version: 3,
      poll_interval: '5m',
      apps: {
        demo: {
          repo: upstream,
          branch: 'main',
          domains: [{ host: 'demo.example.com', port: 3000 }],
          env_file: '.env',
        },
      },
    } as Config

    // Pre-clone so gitsitter's handler skips the URL-based clone step and
    // just fetches from the existing tmpdir origin.
    const demoApp = cfg.apps.demo
    if (!demoApp) throw new Error('demo app missing')
    const workdir = repoPath(paths, 'demo', demoApp.repo)
    await $`mkdir -p ${workdir}`.quiet()
    await $`git clone ${upstream} ${workdir}`.quiet()

    const bus = new FakeBus()
    const dockerCalls: string[][] = []
    const fakeExec: DockerExec = async (args): Promise<ExecResult> => {
      dockerCalls.push([...args])
      return { stdout: '', stderr: '', exitCode: 0 }
    }
    const store = new Store(paths.stateDir)
    const engine = new Engine({
      config: cfg,
      paths,
      store,
      log: createLogger('int'),
      diskFree: async () => 10 * 1024 * 1024 * 1024,
      dockerExec: fakeExec,
    })

    registerGitsitter(bus.asBus(), paths, () => cfg)
    registerDeployerHandlers(bus.asBus(), engine)

    // Wire the CLI-orchestrator flow: when evt.repo.ready fires, emit cmd.deploy.
    const deployResults: unknown[] = []
    bus.subscribe(SUBJECTS.evt.deploySuccess, (p) => {
      deployResults.push(p)
    })
    bus.subscribe(SUBJECTS.evt.repoReady, (payload) => {
      const p = payload as { corrId: string; app: string; workdir: string; sha: string }
      bus.publish(SUBJECTS.cmd.deploy, {
        corrId: p.corrId,
        ts: new Date().toISOString(),
        source: 'cli',
        app: p.app,
        workdir: p.workdir,
        sha: p.sha,
        trigger: 'manual' as const,
      })
    })

    bus.publish(SUBJECTS.cmd.repoPrepare, {
      corrId: 'flow-1',
      ts: new Date().toISOString(),
      source: 'cli',
      app: 'demo',
      ref: 'main',
    })

    for (let i = 0; i < 30; i++) await flush()

    expect(deployResults).toHaveLength(1)
    expect(dockerCalls.some((c) => c.includes('build'))).toBe(true)
    expect(dockerCalls.some((c) => c.includes('up'))).toBe(true)
  })
})
