import { $ } from '@/libs/shell'

export type ExecResult = { ok: boolean; stderr: string; stdout: string }
export type ExecFn = (argv: string[]) => Promise<ExecResult>

const defaultExec: ExecFn = async (argv) => {
  if (argv.length === 0) return { ok: false, stderr: 'empty argv', stdout: '' }
  const res = await $`${argv}`
  return { ok: res.exitCode === 0, stderr: res.stderr, stdout: res.stdout }
}

const current: ExecFn = defaultExec

/** Returns the current exec adapter used by ingress backends. */
export function ingressGetExec(): ExecFn {
  return current
}
