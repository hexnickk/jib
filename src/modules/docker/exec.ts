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

/** Runs Docker with injectable execution options and returns a result for every process outcome. */
export type DockerExec = (args: string[], opts: ExecOpts) => Promise<ExecResult>

/** Spawns a command with inherited stdio so the caller's TTY flows straight through to the child. */
export async function dockerSpawnInherit(
  command: string[],
  cwd: string | undefined,
  env: Record<string, string>,
): Promise<ExecResult> {
  const options =
    cwd === undefined ? { env, stdio: 'inherit' as const } : { cwd, env, stdio: 'inherit' as const }
  try {
    const result = await $(options)`${command}`
    return { stdout: '', stderr: '', exitCode: result.exitCode ?? 0 }
  } catch (error) {
    return {
      stdout: '',
      stderr: error instanceof Error ? error.message : String(error),
      exitCode: 1,
    }
  }
}

/** Executes Docker and maps process-launch failures to a non-zero result instead of throwing. */
export const dockerRealExec: DockerExec = async (args, opts) => {
  const env = { ...process.env, ...(opts.env ?? {}) } as Record<string, string>
  if (opts.tty) {
    return await dockerSpawnInherit(args, opts.cwd, env)
  }
  try {
    const result = await $({
      cwd: opts.cwd ?? process.cwd(),
      env,
      ...(opts.capture ? {} : { stdio: 'inherit' as const }),
    })`${args}`
    if (opts.capture) {
      return {
        stdout: result.stdout.trimEnd(),
        stderr: result.stderr.trimEnd(),
        exitCode: result.exitCode ?? 0,
      }
    }
    return { stdout: '', stderr: '', exitCode: result.exitCode ?? 0 }
  } catch (error) {
    return {
      stdout: '',
      stderr: error instanceof Error ? error.message : String(error),
      exitCode: 1,
    }
  }
}
