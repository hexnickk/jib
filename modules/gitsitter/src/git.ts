import { JibError } from '@jib/core'
import { $ } from 'bun'

type ShellOutput = Awaited<ReturnType<ReturnType<typeof $>['nothrow']>>

/**
 * Private git ops for gitsitter. Every command goes through `Bun.$` and
 * returns trimmed stdout; errors are wrapped in `JibError('git', ...)` with
 * stderr attached for diagnostics. Reference: `_legacy/internal/git/git.go`.
 *
 * This file is NOT exported from `modules/gitsitter/index.ts` — it is the
 * sole owner of git operations in jib, and nothing outside this module
 * should touch git directly. See the plan's Stage 4 architectural
 * constraints.
 */

export interface GitEnv {
  GIT_SSH_COMMAND?: string
}

function check(out: ShellOutput, label: string): void {
  if (out.exitCode !== 0) {
    throw new JibError('git', `${label}: ${out.stderr.toString().trim()}`)
  }
}

async function run(args: string[], env: GitEnv = {}): Promise<ShellOutput> {
  const mergedEnv = { ...process.env, ...env } as Record<string, string>
  return $`git ${args}`.env(mergedEnv).quiet().nothrow()
}

async function runIn(dir: string, args: string[], env: GitEnv = {}): Promise<ShellOutput> {
  const mergedEnv = { ...process.env, ...env } as Record<string, string>
  return $`git -C ${dir} ${args}`.env(mergedEnv).quiet().nothrow()
}

export async function clone(
  url: string,
  dir: string,
  opts: { branch?: string; env?: GitEnv } = {},
): Promise<void> {
  const args = ['clone']
  if (opts.branch) args.push('--branch', opts.branch, '--single-branch')
  args.push(url, dir)
  check(await run(args, opts.env ?? {}), 'git clone')
  await markSafeDirectory(dir)
}

export async function fetch(dir: string, ref = '', env: GitEnv = {}): Promise<void> {
  const args = ref ? ['fetch', 'origin', ref] : ['fetch', 'origin']
  check(await runIn(dir, args, env), 'git fetch')
}

export async function checkout(dir: string, ref: string): Promise<void> {
  check(await runIn(dir, ['checkout', ref]), `git checkout ${ref}`)
}

export async function currentSHA(dir: string): Promise<string> {
  const res = await runIn(dir, ['rev-parse', 'HEAD'])
  check(res, 'git rev-parse')
  return res.stdout.toString().trim()
}

export async function remoteSHA(dir: string, branch: string): Promise<string> {
  const res = await runIn(dir, ['rev-parse', `origin/${branch}`])
  check(res, `git rev-parse origin/${branch}`)
  return res.stdout.toString().trim()
}

export async function lsRemote(url: string, ref = 'HEAD', env: GitEnv = {}): Promise<string> {
  const res = await run(['ls-remote', url, ref], env)
  check(res, 'git ls-remote')
  const first = res.stdout.toString().trim().split('\n')[0] ?? ''
  return (first.split('\t')[0] ?? '').trim()
}

export async function isRepo(dir: string): Promise<boolean> {
  const res = await runIn(dir, ['rev-parse', '--git-dir'])
  return res.exitCode === 0
}

export async function hasRemote(dir: string): Promise<boolean> {
  const res = await runIn(dir, ['remote', 'get-url', 'origin'])
  return res.exitCode === 0
}

export async function setRemoteURL(dir: string, url: string): Promise<void> {
  check(await runIn(dir, ['remote', 'set-url', 'origin', url]), 'git remote set-url')
}

/** Adds `dir` to git's global `safe.directory` list so other users in the jib group can operate on it. */
export async function markSafeDirectory(dir: string): Promise<void> {
  // Best-effort; don't throw if it fails (some hardened environments deny this).
  await run(['config', '--global', '--add', 'safe.directory', dir])
}

/**
 * Build a `GitEnv` that tells git to use a specific SSH identity. Returned
 * object is merged with `process.env` by every `run*` call, so callers just
 * pass it through as the `env` option.
 */
export function configureSSHKey(keyPath: string): GitEnv {
  return {
    GIT_SSH_COMMAND: `ssh -i ${keyPath} -o StrictHostKeyChecking=accept-new`,
  }
}
