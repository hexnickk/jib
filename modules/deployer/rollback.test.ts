import { describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Config } from '@jib/config'
import { createLogger, getPaths } from '@jib/core'
import type { DockerExec, ExecResult } from '@jib/docker'
import { Store } from '@jib/state'
import { Engine } from './engine.ts'
import { rollback } from './rollback.ts'

async function mkEnv() {
  const root = await mkdtemp(join(tmpdir(), 'jib-root-'))
  await mkdir(join(root, 'state'), { recursive: true })
  return { paths: getPaths(root), store: new Store(join(root, 'state')) }
}

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

describe('rollback', () => {
  test('swaps deployed/previous and calls compose up against previous workdir', async () => {
    const { paths, store } = await mkEnv()
    const prevWd = await mkWorkdir()
    const curWd = await mkWorkdir()
    await store.save('demo', {
      schema_version: 1,
      app: 'demo',
      strategy: 'restart',
      deployed_sha: 'new',
      deployed_workdir: curWd,
      previous_sha: 'old',
      previous_workdir: prevWd,
      pinned: false,
      last_deploy: '',
      last_deploy_status: '',
      last_deploy_error: '',
      last_deploy_trigger: '',
      last_deploy_user: '',
      consecutive_failures: 0,
    })

    const calls: string[][] = []
    const exec: DockerExec = async (args): Promise<ExecResult> => {
      calls.push([...args])
      return { stdout: '', stderr: '', exitCode: 0 }
    }
    const engine = new Engine({
      config: cfg,
      paths,
      store,
      log: createLogger('test'),
      dockerExec: exec,
    })
    const res = await rollback(engine, { app: 'demo' })
    expect(res.deployedSHA).toBe('old')
    expect(res.previousSHA).toBe('new')
    const state = await store.load('demo')
    expect(state.deployed_sha).toBe('old')
    expect(state.deployed_workdir).toBe(prevWd)
    expect(calls.some((c) => c.includes('up'))).toBe(true)
  })

  test('errors when no previous deploy recorded', async () => {
    const { paths, store } = await mkEnv()
    const engine = new Engine({ config: cfg, paths, store, log: createLogger('test') })
    await expect(rollback(engine, { app: 'demo' })).rejects.toThrow(/no previous deploy/)
  })

  test('errors with a clear message when previous_workdir no longer exists', async () => {
    const { paths, store } = await mkEnv()
    await store.save('demo', {
      schema_version: 1,
      app: 'demo',
      strategy: 'restart',
      deployed_sha: 'new',
      deployed_workdir: '/tmp/jib-cur-missing',
      previous_sha: 'old',
      previous_workdir: '/tmp/jib-does-not-exist-xyz',
      pinned: false,
      last_deploy: '',
      last_deploy_status: '',
      last_deploy_error: '',
      last_deploy_trigger: '',
      last_deploy_user: '',
      consecutive_failures: 0,
    })
    const engine = new Engine({ config: cfg, paths, store, log: createLogger('test') })
    await expect(rollback(engine, { app: 'demo' })).rejects.toThrow(/no longer exists on disk/)
  })
})
