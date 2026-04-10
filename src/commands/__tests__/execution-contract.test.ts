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
  return runEntry(root, 'apps/jib/main.ts', args)
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
  test('non-interactive add without repo returns structured JSON', async () => {
    await withTmpRoot(async (root) => {
      const result = await runCli(root, ['--interactive=never', '--output=json', 'add', 'demo'])
      expect(result.exitCode).toBe(1)
      expect(result.stdout).toBe('')
      const parsed = JSON.parse(result.stderr)
      expect(parsed.ok).toBe(false)
      expect(parsed.error.code).toBe('missing_input')
      expect(parsed.error.issues).toEqual([
        { field: 'repo', message: 'provide --repo or rerun with interactive prompts enabled' },
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
      expect(parsedHelp.data.usage).toContain('USAGE `jib')
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

  test('invalid root runtime flag is normalized instead of crashing', async () => {
    await withTmpRoot(async (root) => {
      const result = await runCli(root, ['--output=xml', 'status'])
      expect(result.exitCode).toBe(1)
      expect(result.stdout).toBe('')
      expect(result.stderr).toContain('invalid --output value "xml"')
      expect(result.stderr).not.toContain('error:')
      expect(result.stderr).not.toContain('stack')
    })
  })

  test('non-interactive remove failure returns structured JSON', async () => {
    await withTmpRoot(async (root) => {
      await writeConfig(join(root, 'config.yml'), {
        config_version: 3,
        poll_interval: '5m',
        modules: {},
        sources: {},
        apps: {
          demo: {
            repo: 'owner/name',
            branch: 'main',
            domains: [],
            env_file: '.env',
          },
        },
      } satisfies Config)

      const result = await runCli(root, ['--interactive=never', '--output=json', 'remove', 'demo'])
      expect(result.exitCode).toBe(1)
      expect(result.stdout).toBe('')
      const parsed = JSON.parse(result.stderr)
      expect(parsed.ok).toBe(false)
      expect(parsed.error.code).toBe('missing_input')
      expect(parsed.error.issues).toEqual([
        { field: 'force', message: 'rerun with --force or enable interactive prompts' },
      ])
    })
  })
})
