import { $ } from '@/libs/shell'
import { InternalError } from '@jib/errors'

interface ShellOutput {
  exitCode: number | null
  stdout: string
  stderr: string
}

export interface GitEnv {
  GIT_SSH_COMMAND?: string
}

/** Distinguishes zx process output from a Jib error; zx output also extends Error. */
function isShellOutput(value: ShellOutput | InternalError): value is ShellOutput {
  return typeof value === 'object' && value !== null && 'exitCode' in value
}

/** Maps a non-zero Git process result to an internal error. */
function commandFailure(
  out: ShellOutput | InternalError,
  label: string,
): InternalError | undefined {
  if (!isShellOutput(out)) {
    return out
  }
  if (out.exitCode === 0) {
    return undefined
  }
  const detail =
    out.stderr.toString().trim() ||
    out.stdout.toString().trim() ||
    `command exited with code ${out.exitCode}`
  return new InternalError(detail ? `${label}: ${detail}` : label)
}

/** Runs one Git command without throwing for a non-zero process exit. */
async function run(
  args: string[],
  env: GitEnv = {},
  dir?: string,
): Promise<ShellOutput | InternalError> {
  const mergedEnv = { ...process.env, ...env } as Record<string, string>
  const command = dir ? ['git', '-C', dir, ...args] : ['git', ...args]
  try {
    return await $({ env: mergedEnv, quiet: true })`${command}`
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return new InternalError(`git ${args[0] ?? 'command'}: ${message}`, { cause: error })
  }
}

/** Clones a repo into `dir`, returning a typed git error on failure. */
export async function sourcesGitClone(
  url: string,
  dir: string,
  opts: { branch?: string; env?: GitEnv } = {},
): Promise<InternalError | undefined> {
  const args = ['clone']
  if (opts.branch) {
    args.push('--branch', opts.branch, '--single-branch')
  }
  args.push(url, dir)
  const failure = commandFailure(await run(args, opts.env ?? {}), 'git clone')
  if (failure) {
    return failure
  }
  await markSafeDirectory(dir)
}

/** Adds a shared checkout to Git's safe-directory list as a best-effort compatibility step. */
async function markSafeDirectory(dir: string): Promise<void> {
  await run(['config', '--global', '--add', 'safe.directory', dir])
}

/** Fetches `ref` from `origin`, or all refs when `ref` is empty. */
export async function sourcesGitFetch(
  dir: string,
  ref = '',
  env: GitEnv = {},
): Promise<InternalError | undefined> {
  const args = ref ? ['fetch', 'origin', ref] : ['fetch', 'origin']
  return commandFailure(await run(args, env, dir), 'git fetch')
}

/** Checks out `ref` in an existing local checkout. */
export async function sourcesGitCheckout(
  dir: string,
  ref: string,
): Promise<InternalError | undefined> {
  return commandFailure(await run(['checkout', ref], {}, dir), `git checkout ${ref}`)
}

/** Returns the current `HEAD` SHA for a local checkout. */
export async function sourcesGitCurrentSha(dir: string): Promise<string | InternalError> {
  const result = await run(['rev-parse', 'HEAD'], {}, dir)
  const failure = commandFailure(result, 'git rev-parse')
  if (failure) {
    return failure
  }
  if (!isShellOutput(result)) {
    return result
  }
  return result.stdout.toString().trim()
}

/** Returns the SHA recorded in `FETCH_HEAD` after a fetch. */
export async function sourcesGitFetchedSha(dir: string): Promise<string | InternalError> {
  const result = await run(['rev-parse', 'FETCH_HEAD'], {}, dir)
  const failure = commandFailure(result, 'git rev-parse FETCH_HEAD')
  if (failure) {
    return failure
  }
  if (!isShellOutput(result)) {
    return result
  }
  return result.stdout.toString().trim()
}

/** Resolves the SHA for `ref` without creating a local checkout. */
export async function sourcesGitLsRemote(
  url: string,
  ref = 'HEAD',
  env: GitEnv = {},
): Promise<string | InternalError> {
  const result = await run(['ls-remote', url, ref], env)
  const failure = commandFailure(result, 'git ls-remote')
  if (failure) {
    return failure
  }
  if (!isShellOutput(result)) {
    return result
  }
  const first = result.stdout.toString().trim().split('\n')[0] ?? ''
  return (first.split('\t')[0] ?? '').trim()
}

/** Resolves the remote default branch, if the remote reports one. */
export async function sourcesGitDefaultBranch(
  url: string,
  env: GitEnv = {},
): Promise<string | InternalError | undefined> {
  const result = await run(['ls-remote', '--symref', url, 'HEAD'], env)
  const failure = commandFailure(result, 'git ls-remote --symref')
  if (failure) {
    return failure
  }
  if (!isShellOutput(result)) {
    return result
  }
  for (const line of result.stdout.toString().split('\n')) {
    const match = /^ref:\s+refs\/heads\/([^\t]+)\tHEAD$/.exec(line.trim())
    if (match?.[1]) {
      return match[1]
    }
  }
  return undefined
}

/** Returns true when `dir` is already a Git worktree. */
export async function sourcesGitIsRepo(dir: string): Promise<boolean> {
  const result = await run(['rev-parse', '--git-dir'], {}, dir)
  return isShellOutput(result) && result.exitCode === 0
}

/** Returns true when `origin` is configured for `dir`. */
export async function sourcesGitHasRemote(dir: string): Promise<boolean> {
  const result = await run(['remote', 'get-url', 'origin'], {}, dir)
  return isShellOutput(result) && result.exitCode === 0
}

/** Updates the configured `origin` URL for an existing checkout. */
export async function sourcesGitSetRemoteUrl(
  dir: string,
  url: string,
): Promise<InternalError | undefined> {
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
