import { $ } from 'bun'

/** Result of a captured docker invocation. */
export interface ExecResult {
  stdout: string
  stderr: string
  exitCode: number
}

/**
 * Thin indirection over `Bun.$` so tests can inject a fake. Takes the full
 * argv (first element is always `docker`) plus the working directory; returns
 * stdout/stderr as trimmed strings.
 */
export type DockerExec = (
  args: string[],
  opts: { cwd?: string; capture?: boolean; env?: Record<string, string> },
) => Promise<ExecResult>

export const realExec: DockerExec = async (args, opts) => {
  const [_cmd, ...rest] = args
  const built = $`docker ${rest}`.cwd(opts.cwd ?? process.cwd())
  const env = { ...process.env, ...(opts.env ?? {}) }
  const shell = built.env(env as Record<string, string>)
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
