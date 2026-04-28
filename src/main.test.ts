import { describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { configWrite } from '@jib/config'
import type { Config } from '@jib/config'

async function withTmpRoot<T>(fn: (root: string) => Promise<T>): Promise<T> {
  const root = await mkdtemp(join(tmpdir(), 'jib-exec-contract-'))
  try {
    await mkdir(root, { recursive: true })
    expect(
      await configWrite(join(root, 'config.yml'), {
        config_version: 3,
        poll_interval: '5m',
        modules: {},
        sources: {},
        apps: {},
      } satisfies Config),
    ).toBeUndefined()
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
  test('non-interactive add without app returns text errors', async () => {
    await withTmpRoot(async (root) => {
      const result = await runCli(root, ['--interactive=never', 'add'])
      expect(result.exitCode).toBe(1)
      expect(result.stdout).toBe('')
      expect(result.stderr).toContain('missing required input for jib add')
      expect(result.stderr).toContain(
        'app: provide <app> or rerun with interactive prompts enabled',
      )
      expect(result.stderr).not.toContain('stack')
    })
  })

  test('help and version render text', async () => {
    await withTmpRoot(async (root) => {
      const version = await runCli(root, ['--version'])
      expect(version.exitCode).toBe(0)
      expect(version.stderr).toBe('')
      expect(version.stdout.trim()).toBe('0.1.0')

      const help = await runCli(root, ['--help'])
      expect(help.exitCode).toBe(0)
      expect(help.stderr).toBe('')
      expect(help.stdout).toContain('jib <command>')
      expect(help.stdout).toContain('Commands:')
    })
  })

  test('root invocation renders help instead of failing', async () => {
    await withTmpRoot(async (root) => {
      const textHelp = await runCli(root, [])
      expect(textHelp.exitCode).toBe(0)
      expect(textHelp.stderr).toBe('')
      expect(textHelp.stdout).toContain('jib <command>')
      expect(textHelp.stdout).toContain('Commands:')
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

      const missingCommand = await runCli(root, ['exec', 'demo', '--'])
      expect(missingCommand.exitCode).toBe(1)
      expect(missingCommand.stderr).toContain('command required after app')
      expect(missingCommand.stderr).not.toContain('app "demo" not found in config')
    })
  })

  test('status renders apps as labeled text blocks', async () => {
    await withTmpRoot(async (root) => {
      expect(
        await configWrite(join(root, 'config.yml'), {
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
        } satisfies Config),
      ).toBeUndefined()

      const result = await runCli(root, ['--interactive=never', 'status'])
      expect(result.exitCode).toBe(0)
      expect(result.stderr).toBe('')
      expect(result.stdout).toContain('apps\n  demo\n    deploy:   unknown  never deployed')
      expect(result.stdout).toContain('    ingress:  demo.example.com -> :20000')
    })
  })

  test('unknown command prints help and fails', async () => {
    await withTmpRoot(async (root) => {
      const result = await runCli(root, ['wat'])
      expect(result.exitCode).toBe(1)
      expect(result.stdout.trim()).toBe('')
      expect(result.stderr).toContain('jib <command>')
      expect(result.stderr).toContain('Unknown argument: wat')
    })
  })

  test('invalid root runtime flag prints help instead of crashing', async () => {
    await withTmpRoot(async (root) => {
      const result = await runCli(root, ['--interactive=bad', 'status'])
      expect(result.exitCode).toBe(1)
      expect(result.stdout.trim()).toBe('')
      expect(result.stderr).toContain('jib status')
      expect(result.stderr).toContain('Invalid values')
      expect(result.stderr).toContain('interactive')
      expect(result.stderr).not.toContain('[error]')
      expect(result.stderr).not.toContain('error:')
      expect(result.stderr).not.toContain('stack')
    })
  })

  test('output mode flag is not registered', async () => {
    await withTmpRoot(async (root) => {
      const result = await runCli(root, ['--output=json', 'status'])
      expect(result.exitCode).toBe(1)
      expect(result.stdout.trim()).toBe('')
      expect(result.stderr).toContain('jib status')
      expect(result.stderr).toContain('Unknown argument: output')
    })
  })
})
