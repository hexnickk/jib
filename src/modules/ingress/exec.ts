import { $ } from '@/libs/shell'

/** Normalized result returned by an ingress command adapter. */
export type ExecResult = { ok: boolean; stderr: string; stdout: string }
export type ExecFn = (argv: string[]) => Promise<ExecResult>

/** Runs an ingress command and turns process-launch failures into a failed result. */
const defaultExec: ExecFn = async (argv) => {
  if (argv.length === 0) {
    return { ok: false, stderr: 'empty argv', stdout: '' }
  }
  try {
    const result = await $`${argv}`
    return { ok: result.exitCode === 0, stderr: result.stderr, stdout: result.stdout }
  } catch (error) {
    return {
      ok: false,
      stderr: error instanceof Error ? error.message : String(error),
      stdout: '',
    }
  }
}

const current: ExecFn = defaultExec

/** Returns the current exec adapter used by ingress backends. */
export function ingressGetExec(): ExecFn {
  return current
}
