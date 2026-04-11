import { JibError } from '@jib/errors'
import { $ } from 'bun'

type ShellOutput = Awaited<ReturnType<ReturnType<typeof $>['nothrow']>>

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

export async function fetchedSHA(dir: string): Promise<string> {
  const res = await runIn(dir, ['rev-parse', 'FETCH_HEAD'])
  check(res, 'git rev-parse FETCH_HEAD')
  return res.stdout.toString().trim()
}

export async function lsRemote(url: string, ref = 'HEAD', env: GitEnv = {}): Promise<string> {
  const res = await run(['ls-remote', url, ref], env)
  check(res, 'git ls-remote')
  const first = res.stdout.toString().trim().split('\n')[0] ?? ''
  return (first.split('\t')[0] ?? '').trim()
}

export async function defaultBranch(url: string, env: GitEnv = {}): Promise<string | undefined> {
  const res = await run(['ls-remote', '--symref', url, 'HEAD'], env)
  check(res, 'git ls-remote --symref')
  for (const line of res.stdout.toString().split('\n')) {
    const match = /^ref:\s+refs\/heads\/([^\t]+)\tHEAD$/.exec(line.trim())
    if (match?.[1]) return match[1]
  }
  return undefined
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

export async function markSafeDirectory(dir: string): Promise<void> {
  await run(['config', '--global', '--add', 'safe.directory', dir])
}

export function configureSSHKey(keyPath: string): GitEnv {
  return {
    GIT_SSH_COMMAND: `ssh -i ${keyPath} -o StrictHostKeyChecking=accept-new`,
  }
}
