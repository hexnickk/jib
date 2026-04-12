import { describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { writeConfig } from '@jib/config'
import type { Config } from '@jib/config'

async function withTmpRoot<T>(fn: (root: string) => Promise<T>): Promise<T> {
  const root = await mkdtemp(join(tmpdir(), 'jib-exec-contract-'))
  try {
    await mkdir(root, { recursive: true })
    await writeConfig(join(root, 'config.yml'), {
      config_version: 3,
      poll_interval: '5m',
      modules: {},
      sources: {},
      apps: {},
    } satisfies Config)
    return await fn(root)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}

async function runCli(root: string, args: string[]) {
  return runEntry(root, 'src/main.ts', args)
}

async function runEntry(root: string, entrypoint: string, args: string[]) {
  const proc = Bun.spawn([process.execPath, 'run', join(process.cwd(), entrypoint), ...args], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      JIB_ROOT: root,
    },
    stdout: 'pipe',
    stderr: 'pipe',
  })
  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ])
  const exitCode = await proc.exited
  return { exitCode, stdout, stderr }
}

describe('execution contract', () => {
  test('non-interactive add without app returns structured JSON', async () => {
    await withTmpRoot(async (root) => {
      const result = await runCli(root, ['--interactive=never', '--output=json', 'add'])
      expect(result.exitCode).toBe(1)
      expect(result.stdout).toBe('')
      const parsed = JSON.parse(result.stderr)
      expect(parsed.ok).toBe(false)
      expect(parsed.error.code).toBe('missing_input')
      expect(parsed.error.issues).toEqual([
        { field: 'app', message: 'provide <app> or rerun with interactive prompts enabled' },
      ])
    })
  })

  test('help and version honor json output mode', async () => {
    await withTmpRoot(async (root) => {
      const version = await runCli(root, ['--output=json', '--version'])
      expect(version.exitCode).toBe(0)
      expect(version.stderr).toBe('')
      expect(JSON.parse(version.stdout)).toEqual({
        ok: true,
        data: { version: '0.1.0' },
      })

      const help = await runCli(root, ['--output=json', '--help'])
      expect(help.exitCode).toBe(0)
      expect(help.stderr).toBe('')
      const parsedHelp = JSON.parse(help.stdout)
      expect(parsedHelp.ok).toBe(true)
      expect(parsedHelp.data.usage).toContain('jib <command>')
    })
  })

  test('status returns pure json payload in json mode', async () => {
    await withTmpRoot(async (root) => {
      const result = await runCli(root, ['--interactive=never', '--output=json', 'status'])
      expect(result.exitCode).toBe(0)
      expect(result.stderr).toBe('')
      const parsed = JSON.parse(result.stdout)
      expect(parsed.ok).toBe(true)
      expect(Array.isArray(parsed.data.services)).toBe(true)
      expect(Array.isArray(parsed.data.sources)).toBe(true)
      expect(Array.isArray(parsed.data.apps)).toBe(true)
    })
  })

  test('exec and run accept passthrough arguments instead of rejecting the app positional', async () => {
    await withTmpRoot(async (root) => {
      const execResult = await runCli(root, ['exec', 'demo', '--', 'echo', 'ok'])
      expect(execResult.exitCode).toBe(1)
      expect(execResult.stderr).toContain('app "demo" not found in config')
      expect(execResult.stderr).not.toContain('Unknown argument: demo')

      const runResult = await runCli(root, ['run', 'demo', '--', 'echo', 'ok'])
      expect(runResult.exitCode).toBe(1)
      expect(runResult.stderr).toContain('app "demo" not found in config')
      expect(runResult.stderr).not.toContain('Unknown argument: demo')
    })
  })

  test('status renders apps as labeled text blocks in text mode', async () => {
    await withTmpRoot(async (root) => {
      await writeConfig(join(root, 'config.yml'), {
        config_version: 3,
        poll_interval: '5m',
        modules: {},
        sources: {},
        apps: {
          demo: {
            repo: 'acme/demo',
            branch: 'main',
            env_file: '.env',
            domains: [{ host: 'demo.example.com', port: 20000 }],
          },
        },
      } satisfies Config)

      const result = await runCli(root, ['--interactive=never', 'status'])
      expect(result.exitCode).toBe(0)
      expect(result.stderr).toBe('')
      expect(result.stdout).toContain('apps\n  demo\n    deploy:   unknown  never deployed')
      expect(result.stdout).toContain('    ingress:  demo.example.com -> :20000')
    })
  })

  test('invalid root runtime flag is normalized instead of crashing', async () => {
    await withTmpRoot(async (root) => {
      const result = await runCli(root, ['--output=xml', 'status'])
      expect(result.exitCode).toBe(1)
      expect(result.stdout).toBe('')
      expect(result.stderr).toContain('invalid --output value "xml"')
      expect(result.stderr).not.toContain('[error]')
      expect(result.stderr).not.toContain('error:')
      expect(result.stderr).not.toContain('stack')
    })
  })
})
