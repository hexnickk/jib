import { describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Config } from '@jib/config'
import { createLogger, getPaths } from '@jib/core'
import type { DockerExec, ExecResult } from '@jib/docker'
import { FakeBus, SUBJECTS, flush } from '@jib/rpc'
import { Store } from '@jib/state'
import { Engine } from './engine.ts'
import { registerDeployerHandlers } from './handlers.ts'

async function mkWorkdir(): Promise<string> {
  const d = await mkdtemp(join(tmpdir(), 'jib-wd-'))
  await writeFile(join(d, 'docker-compose.yml'), 'services:\n  web:\n    image: nginx\n')
  return d
}

const cfg: Config = {
  config_version: 3,
  poll_interval: '5m',
  apps: {
    demo: {
      repo: 'local',
      branch: 'main',
      domains: [{ host: 'demo.example.com', port: 3000 }],
      env_file: '.env',
    },
  },
} as Config

describe('deployer handlers', () => {
  test('cmd.deploy → evt.deploy.success', async () => {
    const root = await mkdtemp(join(tmpdir(), 'jib-root-'))
    await mkdir(join(root, 'locks'), { recursive: true })
    await mkdir(join(root, 'state'), { recursive: true })
    const paths = getPaths(root)
    const store = new Store(paths.stateDir)
    const exec: DockerExec = async (): Promise<ExecResult> => ({
      stdout: '',
      stderr: '',
      exitCode: 0,
    })
    const engine = new Engine({
      config: cfg,
      paths,
      store,
      log: createLogger('test'),
      diskFree: async () => 10 * 1024 * 1024 * 1024,
      dockerExec: exec,
    })
    const bus = new FakeBus()
    const successes: unknown[] = []
    bus.subscribe(SUBJECTS.evt.deploySuccess, (p) => {
      successes.push(p)
    })
    registerDeployerHandlers(bus.asBus(), () => engine)

    const workdir = await mkWorkdir()
    bus.publish(SUBJECTS.cmd.deploy, {
      corrId: 'c1',
      ts: new Date().toISOString(),
      source: 'cli',
      app: 'demo',
      workdir,
      sha: 'abcd',
      trigger: 'manual',
    })
    for (let i = 0; i < 15; i++) await flush()
    expect(successes).toHaveLength(1)
  })
})
