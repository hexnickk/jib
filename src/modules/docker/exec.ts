import { $ } from '@/libs/shell'

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
   * When true, runs with inherited stdio (including stdin) so interactive flows
   * like `docker compose exec -it` forward a real TTY. Mutually exclusive with `capture`.
   */
  tty?: boolean
}

/**
 * Thin indirection over zx so tests can inject a fake. Takes the full argv
 * (first element is always `docker`) plus the working directory; returns
 * stdout/stderr as trimmed strings.
 */
export type DockerExec = (args: string[], opts: ExecOpts) => Promise<ExecResult>

/**
 * Spawns a command with inherited stdio so the caller's TTY flows straight
 * through to the child. Split out from `dockerRealExec` so tests can target it.
 */
export async function dockerSpawnInherit(
  cmd: string[],
  cwd: string | undefined,
  env: Record<string, string>,
): Promise<ExecResult> {
  const opts =
    cwd === undefined ? { env, stdio: 'inherit' as const } : { cwd, env, stdio: 'inherit' as const }
  const res = await $(opts)`${cmd}`
  return { stdout: '', stderr: '', exitCode: res.exitCode ?? 0 }
}

export const dockerRealExec: DockerExec = async (args, opts) => {
  const env = { ...process.env, ...(opts.env ?? {}) } as Record<string, string>
  if (opts.tty) {
    return dockerSpawnInherit(args, opts.cwd, env)
  }
  const res = await $({
    cwd: opts.cwd ?? process.cwd(),
    env,
    ...(opts.capture ? {} : { stdio: 'inherit' as const }),
  })`${args}`
  if (opts.capture) {
    return {
      stdout: res.stdout.trimEnd(),
      stderr: res.stderr.trimEnd(),
      exitCode: res.exitCode ?? 0,
    }
  }
  return { stdout: '', stderr: '', exitCode: res.exitCode ?? 0 }
}
