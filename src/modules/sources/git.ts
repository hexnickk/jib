import { JibError } from '@jib/errors'
import { $ } from 'bun'

type ShellOutput = Awaited<ReturnType<ReturnType<typeof $>['nothrow']>>

export interface GitEnv {
  GIT_SSH_COMMAND?: string
}

export class SourceGitCommandError extends JibError {
  constructor(command: string, detail: string) {
    super('source_git_command', detail ? `${command}: ${detail}` : command)
  }
}

function commandFailure(out: ShellOutput, label: string): SourceGitCommandError | undefined {
  if (out.exitCode === 0) return undefined
  const detail =
    out.stderr.toString().trim() ||
    out.stdout.toString().trim() ||
    `command exited with code ${out.exitCode}`
  return new SourceGitCommandError(label, detail)
}

async function run(args: string[], env: GitEnv = {}, dir?: string): Promise<ShellOutput> {
  const mergedEnv = { ...process.env, ...env } as Record<string, string>
  return dir
    ? $`git -C ${dir} ${args}`.env(mergedEnv).quiet().nothrow()
    : $`git ${args}`.env(mergedEnv).quiet().nothrow()
}

/** Clones a repo into `dir`, returning a typed git error on failure. */
export async function sourcesGitClone(
  url: string,
  dir: string,
  opts: { branch?: string; env?: GitEnv } = {},
): Promise<SourceGitCommandError | undefined> {
  const args = ['clone']
  if (opts.branch) args.push('--branch', opts.branch, '--single-branch')
  args.push(url, dir)
  const failure = commandFailure(await run(args, opts.env ?? {}), 'git clone')
  if (failure) return failure
  await markSafeDirectory(dir)
}

async function markSafeDirectory(dir: string): Promise<void> {
  // Shared checkouts live under a common root, so keep the old safe-directory
  // registration as best-effort compatibility for mixed-ownership hosts.
  await run(['config', '--global', '--add', 'safe.directory', dir])
}

/** Fetches `ref` from `origin`, or all refs when `ref` is empty. */
export async function sourcesGitFetch(
  dir: string,
  ref = '',
  env: GitEnv = {},
): Promise<SourceGitCommandError | undefined> {
  const args = ref ? ['fetch', 'origin', ref] : ['fetch', 'origin']
  return commandFailure(await run(args, env, dir), 'git fetch')
}

/** Checks out `ref` in an existing local checkout. */
export async function sourcesGitCheckout(
  dir: string,
  ref: string,
): Promise<SourceGitCommandError | undefined> {
  return commandFailure(await run(['checkout', ref], {}, dir), `git checkout ${ref}`)
}

/** Returns the current `HEAD` SHA for a local checkout. */
export async function sourcesGitCurrentSha(dir: string): Promise<string | SourceGitCommandError> {
  const res = await run(['rev-parse', 'HEAD'], {}, dir)
  const failure = commandFailure(res, 'git rev-parse')
  if (failure) return failure
  return res.stdout.toString().trim()
}

/** Returns the SHA recorded in `FETCH_HEAD` after a fetch. */
export async function sourcesGitFetchedSha(dir: string): Promise<string | SourceGitCommandError> {
  const res = await run(['rev-parse', 'FETCH_HEAD'], {}, dir)
  const failure = commandFailure(res, 'git rev-parse FETCH_HEAD')
  if (failure) return failure
  return res.stdout.toString().trim()
}

/** Resolves the SHA for `ref` without creating a local checkout. */
export async function sourcesGitLsRemote(
  url: string,
  ref = 'HEAD',
  env: GitEnv = {},
): Promise<string | SourceGitCommandError> {
  const res = await run(['ls-remote', url, ref], env)
  const failure = commandFailure(res, 'git ls-remote')
  if (failure) return failure
  const first = res.stdout.toString().trim().split('\n')[0] ?? ''
  return (first.split('\t')[0] ?? '').trim()
}

/** Resolves the remote default branch, if the remote reports one. */
export async function sourcesGitDefaultBranch(
  url: string,
  env: GitEnv = {},
): Promise<string | SourceGitCommandError | undefined> {
  const res = await run(['ls-remote', '--symref', url, 'HEAD'], env)
  const failure = commandFailure(res, 'git ls-remote --symref')
  if (failure) return failure
  for (const line of res.stdout.toString().split('\n')) {
    const match = /^ref:\s+refs\/heads\/([^\t]+)\tHEAD$/.exec(line.trim())
    if (match?.[1]) return match[1]
  }
  return undefined
}

/** Returns true when `dir` is already a Git worktree. */
export async function sourcesGitIsRepo(dir: string): Promise<boolean> {
  const res = await run(['rev-parse', '--git-dir'], {}, dir)
  return res.exitCode === 0
}

/** Returns true when `origin` is configured for `dir`. */
export async function sourcesGitHasRemote(dir: string): Promise<boolean> {
  const res = await run(['remote', 'get-url', 'origin'], {}, dir)
  return res.exitCode === 0
}

/** Updates the configured `origin` URL for an existing checkout. */
export async function sourcesGitSetRemoteUrl(
  dir: string,
  url: string,
): Promise<SourceGitCommandError | undefined> {
  return commandFailure(
    await run(['remote', 'set-url', 'origin', url], {}, dir),
    'git remote set-url',
  )
}

/** Builds an SSH env override that pins Git to the chosen private key. */
export function sourcesGitConfigureSshKey(keyPath: string): GitEnv {
  return {
    GIT_SSH_COMMAND: `ssh -i ${keyPath} -o StrictHostKeyChecking=accept-new`,
  }
}
