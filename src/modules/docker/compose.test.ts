import { InternalError } from '@jib/errors'
import { expect, test } from 'vitest'
import { dockerCreateCompose } from './compose.ts'
import type { DockerExec, ExecResult } from './exec.ts'

interface Call {
  args: string[]
  cwd?: string
  env?: Record<string, string>
  capture?: boolean
  tty?: boolean
}

function recorder(result: Partial<ExecResult> = {}): { exec: DockerExec; calls: Call[] } {
  const calls: Call[] = []
  const exec: DockerExec = async (args, opts) => {
    calls.push({ args, ...opts })
    return { stdout: '', stderr: '', exitCode: 0, ...result }
  }
  return { exec, calls }
}

function make(override?: string) {
  const { exec, calls } = recorder()
  const cfg = {
    app: 'demo',
    dir: '/src',
    files: ['docker-compose.yml'],
    envFile: '/src/.env',
    ...(override ? { override } : {}),
    exec,
  }
  return { compose: dockerCreateCompose(cfg), calls }
}

test('dockerCreateCompose > projectName prefixes with jib-', () => {
  expect(dockerCreateCompose({ app: 'foo', dir: '.', files: [] }).projectName()).toBe('jib-foo')
})

test('dockerCreateCompose > baseArgs includes project and compose files', () => {
  const { compose } = make()
  expect(compose.baseArgs()).toEqual(['compose', '-p', 'jib-demo', '-f', 'docker-compose.yml'])
})

test('dockerCreateCompose > up passes --force-recreate and --remove-orphans', async () => {
  const { compose, calls } = make()
  await compose.up()
  expect(calls[0]?.args).toContain('up')
  expect(calls[0]?.args).toContain('-d')
  expect(calls[0]?.args).toContain('--force-recreate')
  expect(calls[0]?.args).toContain('--remove-orphans')
  expect(calls[0]?.cwd).toBe('/src')
})

test('dockerCreateCompose > up forwards build args as env', async () => {
  const { compose, calls } = make()
  await compose.up({ buildArgs: { FOO: 'bar' } })
  expect(calls[0]?.env).toEqual({ FOO: 'bar' })
})

test('dockerCreateCompose > down -v when removeVolumes is true', async () => {
  const { compose, calls } = make()
  await compose.down(true)
  expect(calls[0]?.args.slice(-1)).toEqual(['-v'])
})

test('dockerCreateCompose > exec maps to docker compose exec <service> <cmd...>', async () => {
  const { compose, calls } = make()
  await compose.exec('web', ['sh', '-c', 'ls'])
  const args = calls[0]?.args ?? []
  expect(args.slice(-5)).toEqual(['exec', 'web', 'sh', '-c', 'ls'])
})

test('dockerCreateCompose > exec requests a TTY so stdin forwards through', async () => {
  const { compose, calls } = make()
  await compose.exec('web', ['sh'])
  expect(calls[0]?.tty).toBe(true)
})

test('dockerCreateCompose > run requests a TTY so stdin forwards through', async () => {
  const { compose, calls } = make()
  await compose.run('web', ['sh'])
  expect(calls[0]?.tty).toBe(true)
})

test('dockerCreateCompose > logs maps follow, tail, and service args', async () => {
  const { compose, calls } = make()
  await compose.logs('web', { follow: true, tail: 100 })
  expect(calls[0]?.args.slice(-5)).toEqual(['logs', '-f', '--tail', '100', 'web'])
})

test('dockerCreateCompose > logs can target all services', async () => {
  const { compose, calls } = make()
  await compose.logs()
  expect(calls[0]?.args.slice(-1)).toEqual(['logs'])
})

test('dockerCreateCompose > captures build/up/down/restart output only when quiet is requested', async () => {
  const { compose, calls } = make()
  await compose.build({}, { quiet: true })
  await compose.up({ quiet: true })
  await compose.down(false, { quiet: true })
  await compose.restart([], { quiet: true })
  await compose.build()
  await compose.up()
  await compose.down()
  await compose.restart()

  expect(calls.slice(0, 4).map((call) => call.capture)).toEqual([true, true, true, true])
  for (const call of calls.slice(4)) {
    expect(call).not.toHaveProperty('capture')
  }
  expect(calls.every((call) => call.cwd === '/src')).toBe(true)
})

test('dockerCreateCompose > ps captures and returns the command result', async () => {
  const result = { stdout: '{"Name":"web"}', stderr: '', exitCode: 0 }
  const { exec, calls } = recorder(result)
  const compose = dockerCreateCompose({ app: 'demo', dir: '/src', files: [], exec })

  expect(await compose.ps()).toEqual(result)
  expect(calls).toEqual([
    {
      args: ['docker', 'compose', '-p', 'jib-demo', 'ps', '--format', 'json'],
      cwd: '/src',
      capture: true,
    },
  ])
})

test.each(['up', 'ps'] as const)(
  'dockerCreateCompose > %s preserves thrown execution failures as causes',
  async (command) => {
    const failure = new Error('docker unavailable')
    const compose = dockerCreateCompose({
      app: 'demo',
      dir: '.',
      files: [],
      exec: async () => {
        throw failure
      },
    })
    const result = await compose[command]()
    expect(result).toBeInstanceOf(InternalError)
    expect(result).toHaveProperty(
      'message',
      'docker compose -p jib-demo failed: docker unavailable',
    )
    expect(result).toHaveProperty('cause', failure)
  },
)

test.each(['up', 'ps'] as const)(
  'dockerCreateCompose > %s retains its non-zero exit diagnostics',
  async (command) => {
    const { exec } = recorder({ stdout: 'stdout detail', exitCode: 1 })
    const compose = dockerCreateCompose({ app: 'demo', dir: '.', files: [], exec })
    const result = await compose[command]()
    expect(result).toBeInstanceOf(InternalError)
    expect(result).toHaveProperty(
      'message',
      `docker compose -p jib-demo exited 1: ${command === 'up' ? 'stdout detail' : ''}`,
    )
  },
)

test('dockerCreateCompose > returns an internal error on non-zero exit', async () => {
  const exec: DockerExec = async () => ({ stdout: '', stderr: 'boom', exitCode: 2 })
  const compose = dockerCreateCompose({ app: 'demo', dir: '.', files: [], exec })
  const result = await compose.up()
  expect(result).toBeInstanceOf(InternalError)
  expect(result?.message).toContain('exited 2')
})
