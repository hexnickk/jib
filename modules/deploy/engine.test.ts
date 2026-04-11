import { describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Config } from '@jib/config'
import type { DockerExec, ExecResult } from '@jib/docker'
import { createLogger } from '@jib/logging'
import { getPaths, repoPath } from '@jib/paths'
import { Store } from '@jib/state'
import { Engine } from './engine.ts'

function mkCfg(): Config {
  return {
    config_version: 3,
    poll_interval: '5m',
    modules: {},
    sources: {},
    apps: {
      demo: {
        repo: 'local',
        branch: 'main',
        domains: [{ host: 'demo.example.com', port: 3000 }],
        env_file: '.env',
      },
    },
  }
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
  env?: Record<string, string>
}

function fakeExec(calls: Call[], exitCode = 0): DockerExec {
  return async (args, opts): Promise<ExecResult> => {
    calls.push({ args: [...args], ...(opts.env ? { env: opts.env } : {}) })
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

  test('forwards build args to both build and up', async () => {
    const { paths, store, log } = await mkEnv()
    const workdir = await mkWorkdir()
    const calls: Call[] = []
    const cfg = mkCfg()
    const demo = cfg.apps.demo
    if (!demo) throw new Error('demo app missing in test fixture')
    demo.build_args = { VITE_HOST_URL: 'https://demo.example.com' }
    const engine = new Engine({
      config: cfg,
      paths,
      store,
      log,
      diskFree: async () => 10 * 1024 * 1024 * 1024,
      dockerExec: fakeExec(calls),
    })

    await engine.deploy({ app: 'demo', workdir, sha: 'deadbeef', trigger: 'manual' }, noProgress)

    const buildCall = calls.find((c) => c.args.includes('build'))
    const upCall = calls.find((c) => c.args.includes('up'))
    expect(buildCall?.env).toEqual({ VITE_HOST_URL: 'https://demo.example.com' })
    expect(upCall?.env).toEqual({ VITE_HOST_URL: 'https://demo.example.com' })
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

  test('zero-domain app deploys without managed ports override', async () => {
    const { paths, store, log } = await mkEnv()
    const workdir = await mkWorkdir()
    const calls: Call[] = []
    const cfg = mkCfg()
    cfg.apps.demo = {
      repo: 'local',
      branch: 'main',
      domains: [],
      env_file: '.env',
    }
    const engine = new Engine({
      config: cfg,
      paths,
      store,
      log,
      diskFree: async () => 10 * 1024 * 1024 * 1024,
      dockerExec: fakeExec(calls),
    })

    await engine.deploy({ app: 'demo', workdir, sha: 'worker1', trigger: 'manual' }, noProgress)

    const override = await readFile(join(paths.overridesDir, 'demo.yml'), 'utf8')
    expect(override).not.toContain('ports:')
    expect(calls.some((c) => c.args.includes('up'))).toBe(true)
  })

  test('up refreshes stale override when app has no domains', async () => {
    const { paths, store, log } = await mkEnv()
    const cfg = mkCfg()
    cfg.apps.demo = {
      repo: 'local',
      branch: 'main',
      domains: [],
      env_file: '.env',
    }
    const workdir = repoPath(paths, 'demo', cfg.apps.demo.repo)
    await mkdir(workdir, { recursive: true })
    await writeFile(
      join(workdir, 'docker-compose.yml'),
      `services:
  worker:
    image: busybox
`,
    )
    await mkdir(paths.overridesDir, { recursive: true })
    await writeFile(
      join(paths.overridesDir, 'demo.yml'),
      `services:
  worker:
    ports:
      - "20000:80"
`,
    )
    const calls: Call[] = []
    const engine = new Engine({
      config: cfg,
      paths,
      store,
      log,
      dockerExec: fakeExec(calls),
    })

    await engine.up('demo')

    const override = await readFile(join(paths.overridesDir, 'demo.yml'), 'utf8')
    expect(override).not.toContain('ports:')
    expect(calls.some((c) => c.args.includes('up'))).toBe(true)
  })
})
