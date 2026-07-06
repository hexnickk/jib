import { spawn } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { configWrite } from '@jib/config'
import type { Config } from '@jib/config'
import { describe, expect, test } from 'vitest'
import pkg from '../package.json' with { type: 'json' }

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

/** Reads a child-process stream fully as UTF-8 text for CLI contract assertions. */
async function streamText(stream: NodeJS.ReadableStream): Promise<string> {
  const chunks: Buffer[] = []
  for await (const chunk of stream) chunks.push(Buffer.from(chunk))
  return Buffer.concat(chunks).toString('utf8')
}

async function runEntry(root: string, entrypoint: string, args: string[]) {
  const proc = spawn(
    process.execPath,
    ['--import', 'tsx', join(process.cwd(), entrypoint), ...args],
    {
      cwd: process.cwd(),
      env: {
        ...process.env,
        JIB_ROOT: root,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  )
  const [stdout, stderr, exitCode] = await Promise.all([
    streamText(proc.stdout),
    streamText(proc.stderr),
    new Promise<number>((resolve) => proc.on('close', (code) => resolve(code ?? 1))),
  ])
  return { exitCode, stdout, stderr }
}

async function writeDemoAppConfig(root: string): Promise<void> {
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
          domains: [],
        },
      },
    } satisfies Config),
  ).toBeUndefined()
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

  test('version renders text', async () => {
    await withTmpRoot(async (root) => {
      const version = await runCli(root, ['--version'])
      expect(version.exitCode).toBe(0)
      expect(version.stderr).toBe('')
      expect(version.stdout.trim()).toBe(pkg.version)
    })
  })

  test('help renders text', async () => {
    await withTmpRoot(async (root) => {
      const help = await runCli(root, ['--help'])
      expect(help.exitCode).toBe(0)
      expect(help.stderr).toBe('')
      expect(help.stdout).toContain('jib <command>')
      expect(help.stdout).toContain('Commands:')
      expect(help.stdout).not.toContain('jib watch')
    })
  })

  test('root invocation renders help instead of failing', async () => {
    await withTmpRoot(async (root) => {
      const textHelp = await runCli(root, [])
      expect(textHelp.exitCode).toBe(0)
      expect(textHelp.stderr).toBe('')
      expect(textHelp.stdout).toContain('jib <command>')
      expect(textHelp.stdout).toContain('Commands:')
      expect(textHelp.stdout).not.toContain('jib watch')
    })
  })

  test('exec accepts passthrough arguments instead of rejecting the app positional', async () => {
    await withTmpRoot(async (root) => {
      const execResult = await runCli(root, ['exec', 'demo', '--', 'echo', 'ok'])
      expect(execResult.exitCode).toBe(1)
      expect(execResult.stderr).toContain('app "demo" not found in config')
      expect(execResult.stderr).not.toContain('Unknown argument: demo')
    })
  })

  test('run accepts passthrough arguments instead of rejecting the app positional', async () => {
    await withTmpRoot(async (root) => {
      const runResult = await runCli(root, ['run', 'demo', '--', 'echo', 'ok'])
      expect(runResult.exitCode).toBe(1)
      expect(runResult.stderr).toContain('app "demo" not found in config')
      expect(runResult.stderr).not.toContain('Unknown argument: demo')
    })
  })

  test('exec reports missing passthrough command before app lookup', async () => {
    await withTmpRoot(async (root) => {
      const missingCommand = await runCli(root, ['exec', 'demo', '--'])
      expect(missingCommand.exitCode).toBe(1)
      expect(missingCommand.stderr).toContain('command required after app')
      expect(missingCommand.stderr).not.toContain('app "demo" not found in config')
    })
  })

  test('secrets set dispatches by action name', async () => {
    await withTmpRoot(async (root) => {
      await writeDemoAppConfig(root)

      const setResult = await runCli(root, ['secrets', 'set', 'demo', 'TOKEN=secret'])
      expect(setResult.exitCode).toBe(0)
      expect(setResult.stderr).toBe('')
      expect(await readFile(join(root, 'secrets', 'demo', '.env'), 'utf8')).toBe('TOKEN=secret\n')
    })
  })

  test('secrets list dispatches by action name', async () => {
    await withTmpRoot(async (root) => {
      await writeDemoAppConfig(root)
      await mkdir(join(root, 'secrets', 'demo'), { recursive: true })
      await writeFile(join(root, 'secrets', 'demo', '.env'), 'TOKEN=secret\n')

      const listResult = await runCli(root, ['secrets', 'list', 'demo'])
      expect(listResult.exitCode).toBe(0)
      expect(listResult.stderr).toBe('')
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
