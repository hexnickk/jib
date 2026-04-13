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

const current: ExecFn = defaultExec

/** Returns the current exec adapter used by ingress backends. */
export function ingressGetExec(): ExecFn {
  return current
}
