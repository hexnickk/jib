/**
 * Small exec indirection so hooks.ts can be unit-tested without touching
 * the host's nginx. Tests import this module and swap the implementation
 * via `setExec`. Production code leaves the default in place.
 */

export type ExecResult = { ok: boolean; stderr: string; stdout: string }
export type ExecFn = (argv: string[]) => Promise<ExecResult>

const defaultExec: ExecFn = async (argv) => {
  const [cmd, ...rest] = argv
  if (!cmd) return { ok: false, stderr: 'empty argv', stdout: '' }
  const res = await Bun.$`${cmd} ${rest}`.nothrow().quiet()
  return {
    ok: res.exitCode === 0,
    stderr: res.stderr.toString(),
    stdout: res.stdout.toString(),
  }
}

let current: ExecFn = defaultExec

export function getExec(): ExecFn {
  return current
}

export function setExec(fn: ExecFn | null): void {
  current = fn ?? defaultExec
}
