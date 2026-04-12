import { $ } from 'bun'

/** Result of a captured docker invocation. */
export interface ExecResult {
  stdout: string
  stderr: string
  exitCode: number
}

export interface ExecOpts {
  cwd?: string
  capture?: boolean
  env?: Record<string, string>
  /**
   * When true, bypasses `Bun.$` and spawns with inherited stdio (including
   * stdin) so interactive flows like `docker compose exec -it` forward a real
   * TTY. Mutually exclusive with `capture`.
   */
  tty?: boolean
}

/**
 * Thin indirection over `Bun.$` so tests can inject a fake. Takes the full
 * argv (first element is always `docker`) plus the working directory; returns
 * stdout/stderr as trimmed strings.
 */
export type DockerExec = (args: string[], opts: ExecOpts) => Promise<ExecResult>

/**
 * Spawns a command with inherited stdio so the caller's TTY flows straight
 * through to the child. Split out from `dockerRealExec` so tests can target it
 * without stubbing `Bun.$`.
 */
export async function dockerSpawnInherit(
  cmd: string[],
  cwd: string | undefined,
  env: Record<string, string>,
): Promise<ExecResult> {
  const proc = Bun.spawn({
    cmd,
    stdin: 'inherit',
    stdout: 'inherit',
    stderr: 'inherit',
    ...(cwd !== undefined && { cwd }),
    env,
  })
  const exitCode = await proc.exited
  return { stdout: '', stderr: '', exitCode }
}

export const dockerRealExec: DockerExec = async (args, opts) => {
  const env = { ...process.env, ...(opts.env ?? {}) } as Record<string, string>
  if (opts.tty) {
    return dockerSpawnInherit(args, opts.cwd, env)
  }
  const [_cmd, ...rest] = args
  const built = $`docker ${rest}`.cwd(opts.cwd ?? process.cwd())
  const shell = built.env(env)
  if (opts.capture) {
    const res = await shell.quiet().nothrow()
    return {
      stdout: res.stdout.toString().trimEnd(),
      stderr: res.stderr.toString().trimEnd(),
      exitCode: res.exitCode,
    }
  }
  const res = await shell.nothrow()
  return { stdout: '', stderr: '', exitCode: res.exitCode }
}
