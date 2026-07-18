import { InternalError } from '@jib/errors'
import { describe, expect, test } from 'vitest'
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
    const call: Call = { args }
    if (opts.cwd !== undefined) {
      call.cwd = opts.cwd
    }
    if (opts.env !== undefined) {
      call.env = opts.env
    }
    if (opts.capture !== undefined) {
      call.capture = opts.capture
    }
    if (opts.tty !== undefined) {
      call.tty = opts.tty
    }
    calls.push(call)
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

describe('dockerCreateCompose', () => {
  test('projectName prefixes with jib-', () => {
    expect(dockerCreateCompose({ app: 'foo', dir: '.', files: [] }).projectName()).toBe('jib-foo')
  })

  test('baseArgs includes project and compose files', () => {
    const { compose } = make()
    expect(compose.baseArgs()).toEqual(['compose', '-p', 'jib-demo', '-f', 'docker-compose.yml'])
  })

  test('up passes --force-recreate and --remove-orphans', async () => {
    const { compose, calls } = make()
    await compose.up()
    expect(calls[0]?.args).toContain('up')
    expect(calls[0]?.args).toContain('-d')
    expect(calls[0]?.args).toContain('--force-recreate')
    expect(calls[0]?.args).toContain('--remove-orphans')
    expect(calls[0]?.cwd).toBe('/src')
  })

  test('up forwards build args as env', async () => {
    const { compose, calls } = make()
    await compose.up({ buildArgs: { FOO: 'bar' } })
    expect(calls[0]?.env).toEqual({ FOO: 'bar' })
  })

  test('down -v when removeVolumes is true', async () => {
    const { compose, calls } = make()
    await compose.down(true)
    expect(calls[0]?.args.slice(-1)).toEqual(['-v'])
  })

  test('exec maps to docker compose exec <service> <cmd...>', async () => {
    const { compose, calls } = make()
    await compose.exec('web', ['sh', '-c', 'ls'])
    const args = calls[0]?.args ?? []
    expect(args.slice(-5)).toEqual(['exec', 'web', 'sh', '-c', 'ls'])
  })

  test('exec requests a TTY so stdin forwards through', async () => {
    const { compose, calls } = make()
    await compose.exec('web', ['sh'])
    expect(calls[0]?.tty).toBe(true)
  })

  test('run requests a TTY so stdin forwards through', async () => {
    const { compose, calls } = make()
    await compose.run('web', ['sh'])
    expect(calls[0]?.tty).toBe(true)
  })

  test('logs maps follow, tail, and service args', async () => {
    const { compose, calls } = make()
    await compose.logs('web', { follow: true, tail: 100 })
    expect(calls[0]?.args.slice(-5)).toEqual(['logs', '-f', '--tail', '100', 'web'])
  })

  test('logs can target all services', async () => {
    const { compose, calls } = make()
    await compose.logs()
    expect(calls[0]?.args.slice(-1)).toEqual(['logs'])
  })

  test('returns an internal error on non-zero exit', async () => {
    const exec: DockerExec = async () => ({ stdout: '', stderr: 'boom', exitCode: 2 })
    const compose = dockerCreateCompose({ app: 'demo', dir: '.', files: [], exec })
    const result = await compose.up()
    expect(result).toBeInstanceOf(InternalError)
    expect(result?.message).toContain('exited 2')
  })
})
