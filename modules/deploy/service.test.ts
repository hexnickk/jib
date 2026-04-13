import { describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Config } from '@jib/config'
import type { DockerExec, ExecResult } from '@jib/docker'
import { loggingCreateLogger } from '@jib/logging'
import { stateCreateStore, stateLoad } from '@jib/state'
import { pathsGetPaths, pathsRepoPath } from '../paths/paths.ts'
import { DeployDiskSpaceError, DeployMissingAppError } from './errors.ts'
import { deployApp, deployUpApp } from './service.ts'

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
  const dir = await mkdtemp(join(tmpdir(), 'jib-workdir-'))
  await writeFile(
    join(dir, 'docker-compose.yml'),
    `services:
  web:
    build:
      context: .
    image: nginx:alpine
`,
  )
  return dir
}

async function mkImageOnlyWorkdir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'jib-image-workdir-'))
  await writeFile(
    join(dir, 'docker-compose.yml'),
    `services:
  web:
    image: nginx:alpine
`,
  )
  return dir
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
  const paths = pathsGetPaths(root)
  const store = stateCreateStore(paths.stateDir)
  return { paths, store, log: loggingCreateLogger('test') }
}

const noProgress = { emit: () => {} }

describe('deployApp', () => {
  test('happy path emits success + records state', async () => {
    const { paths, store, log } = await mkEnv()
    const workdir = await mkWorkdir()
    const calls: Call[] = []

    const result = await deployApp(
      {
        config: mkCfg(),
        paths,
        store,
        log,
        diskFree: async () => 10 * 1024 * 1024 * 1024,
        dockerExec: fakeExec(calls),
      },
      { app: 'demo', workdir, sha: 'deadbeef', trigger: 'manual' },
      noProgress,
    )

    expect(result instanceof Error).toBe(false)
    if (result instanceof Error) return
    expect(result.deployedSHA).toBe('deadbeef')

    const state = await stateLoad(store, 'demo')
    if (state instanceof Error) throw state
    expect(state.deployed_sha).toBe('deadbeef')
    expect(state.deployed_workdir).toBe(workdir)
    expect(calls.some((call) => call.args.includes('build'))).toBe(true)
    expect(calls.some((call) => call.args.includes('up'))).toBe(true)
  })

  test('missing app returns a typed error', async () => {
    const { paths, store, log } = await mkEnv()
    const workdir = await mkWorkdir()

    const result = await deployApp(
      {
        config: mkCfg(),
        paths,
        store,
        log,
        diskFree: async () => 10 * 1024 * 1024 * 1024,
        dockerExec: fakeExec([]),
      },
      { app: 'unknown', workdir, sha: 'deadbeef', trigger: 'manual' },
      noProgress,
    )

    expect(result).toBeInstanceOf(DeployMissingAppError)
  })

  test('forwards build args to both build and up', async () => {
    const { paths, store, log } = await mkEnv()
    const workdir = await mkWorkdir()
    const calls: Call[] = []
    const cfg = mkCfg()
    const demo = cfg.apps.demo
    expect(demo).toBeDefined()
    if (!demo) return
    demo.build_args = { VITE_HOST_URL: 'https://demo.example.com' }

    const result = await deployApp(
      {
        config: cfg,
        paths,
        store,
        log,
        diskFree: async () => 10 * 1024 * 1024 * 1024,
        dockerExec: fakeExec(calls),
      },
      { app: 'demo', workdir, sha: 'deadbeef', trigger: 'manual' },
      noProgress,
    )

    expect(result instanceof Error).toBe(false)
    const buildCall = calls.find((call) => call.args.includes('build'))
    const upCall = calls.find((call) => call.args.includes('up'))
    expect(buildCall?.env).toEqual({ VITE_HOST_URL: 'https://demo.example.com' })
    expect(upCall?.env).toEqual({ VITE_HOST_URL: 'https://demo.example.com' })
  })

  test('insufficient disk space returns a typed error', async () => {
    const { paths, store, log } = await mkEnv()
    const workdir = await mkWorkdir()

    const result = await deployApp(
      {
        config: mkCfg(),
        paths,
        store,
        log,
        diskFree: async () => 1024,
        dockerExec: fakeExec([]),
      },
      { app: 'demo', workdir, sha: 'x', trigger: 'manual' },
      noProgress,
    )

    expect(result).toBeInstanceOf(DeployDiskSpaceError)
  })

  test('build failure records the failure in last-deploy state', async () => {
    const { paths, store, log } = await mkEnv()
    const calls: Call[] = []
    const workdir = await mkWorkdir()

    const result = await deployApp(
      {
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
      },
      { app: 'demo', workdir, sha: 'x', trigger: 'manual' },
      noProgress,
    )

    expect(result instanceof Error).toBe(true)
    const state = await stateLoad(store, 'demo')
    if (state instanceof Error) throw state
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

    const result = await deployApp(
      {
        config: cfg,
        paths,
        store,
        log,
        diskFree: async () => 10 * 1024 * 1024 * 1024,
        dockerExec: fakeExec(calls),
      },
      { app: 'demo', workdir, sha: 'worker1', trigger: 'manual' },
      noProgress,
    )

    expect(result instanceof Error).toBe(false)
    const override = await readFile(join(paths.overridesDir, 'demo.yml'), 'utf8')
    expect(override).not.toContain('ports:')
    expect(calls.some((call) => call.args.includes('up'))).toBe(true)
  })

  test('image-only compose skips the build step', async () => {
    const { paths, store, log } = await mkEnv()
    const workdir = await mkImageOnlyWorkdir()
    const calls: Call[] = []

    const result = await deployApp(
      {
        config: mkCfg(),
        paths,
        store,
        log,
        diskFree: async () => 10 * 1024 * 1024 * 1024,
        dockerExec: fakeExec(calls),
      },
      { app: 'demo', workdir, sha: 'deadbeef', trigger: 'manual' },
      noProgress,
    )

    expect(result instanceof Error).toBe(false)
    expect(calls.some((call) => call.args.includes('build'))).toBe(false)
    expect(calls.some((call) => call.args.includes('up'))).toBe(true)
  })
})
describe('deployUpApp', () => {
  test('refreshes stale override when app has no domains', async () => {
    const { paths, store, log } = await mkEnv()
    const cfg = mkCfg()
    cfg.apps.demo = {
      repo: 'local',
      branch: 'main',
      domains: [],
      env_file: '.env',
    }
    const workdir = pathsRepoPath(paths, 'demo', cfg.apps.demo.repo)
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

    const result = await deployUpApp(
      {
        config: cfg,
        paths,
        store,
        log,
        dockerExec: fakeExec(calls),
      },
      'demo',
    )

    expect(result).toBeUndefined()
    const override = await readFile(join(paths.overridesDir, 'demo.yml'), 'utf8')
    expect(override).not.toContain('ports:')
    expect(calls.some((call) => call.args.includes('up'))).toBe(true)
  })
})
