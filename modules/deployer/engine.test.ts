import { describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Config } from '@jib/config'
import { createLogger, getPaths } from '@jib/core'
import type { DockerExec, ExecResult } from '@jib/docker'
import { Store } from '@jib/state'
import { Engine } from './engine.ts'

function mkCfg(): Config {
  return {
    config_version: 3,
    poll_interval: '5m',
    modules: {},
    apps: {
      demo: {
        repo: 'local',
        branch: 'main',
        domains: [{ host: 'demo.example.com', port: 3000 }],
        env_file: '.env',
      },
    },
  } as Config
}

async function mkWorkdir(): Promise<string> {
  const d = await mkdtemp(join(tmpdir(), 'jib-workdir-'))
  await writeFile(
    join(d, 'docker-compose.yml'),
    `services:
  web:
    image: nginx:alpine
`,
  )
  return d
}

interface Call {
  args: string[]
}

function fakeExec(calls: Call[], exitCode = 0): DockerExec {
  return async (args): Promise<ExecResult> => {
    calls.push({ args: [...args] })
    return { stdout: '', stderr: '', exitCode }
  }
}

async function mkEnv() {
  const root = await mkdtemp(join(tmpdir(), 'jib-root-'))
  await mkdir(join(root, 'locks'), { recursive: true })
  await mkdir(join(root, 'state'), { recursive: true })
  const paths = getPaths(root)
  const store = new Store(paths.stateDir)
  return { paths, store, log: createLogger('test') }
}

const noProgress = { emit: () => {} }

describe('Engine.deploy', () => {
  test('happy path emits success + records state', async () => {
    const { paths, store, log } = await mkEnv()
    const workdir = await mkWorkdir()
    const calls: Call[] = []
    const engine = new Engine({
      config: mkCfg(),
      paths,
      store,
      log,
      diskFree: async () => 10 * 1024 * 1024 * 1024,
      dockerExec: fakeExec(calls),
    })

    const res = await engine.deploy(
      { app: 'demo', workdir, sha: 'deadbeef', trigger: 'manual' },
      noProgress,
    )
    expect(res.deployedSHA).toBe('deadbeef')
    const state = await store.load('demo')
    expect(state.deployed_sha).toBe('deadbeef')
    expect(state.deployed_workdir).toBe(workdir)
    // build + up were called
    expect(calls.some((c) => c.args.includes('build'))).toBe(true)
    expect(calls.some((c) => c.args.includes('up'))).toBe(true)
  })

  test('insufficient disk space throws', async () => {
    const { paths, store, log } = await mkEnv()
    const engine = new Engine({
      config: mkCfg(),
      paths,
      store,
      log,
      diskFree: async () => 1024,
      dockerExec: fakeExec([]),
    })
    const workdir = await mkWorkdir()
    await expect(
      engine.deploy({ app: 'demo', workdir, sha: 'x', trigger: 'manual' }, noProgress),
    ).rejects.toThrow(/insufficient disk space/)
  })

  test('build failure records the failure in last-deploy state', async () => {
    const { paths, store, log } = await mkEnv()
    const calls: Call[] = []
    const engine = new Engine({
      config: mkCfg(),
      paths,
      store,
      log,
      diskFree: async () => 10 * 1024 * 1024 * 1024,
      dockerExec: async (args): Promise<ExecResult> => {
        calls.push({ args: [...args] })
        if (args.includes('build')) return { stdout: '', stderr: 'boom', exitCode: 1 }
        return { stdout: '', stderr: '', exitCode: 0 }
      },
    })
    const workdir = await mkWorkdir()
    await expect(
      engine.deploy({ app: 'demo', workdir, sha: 'x', trigger: 'manual' }, noProgress),
    ).rejects.toThrow()
    const state = await store.load('demo')
    expect(state.last_deploy_status).toBe('failure')
    expect(state.last_deploy_error).toContain('boom')
  })
})
