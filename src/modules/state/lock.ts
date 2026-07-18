import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import type { Readable } from 'node:stream'
import { $ } from '@/libs/shell'
import { InternalError } from '@jib/errors'
import type { ProcessPromise } from 'zx'

export interface LockOptions {
  blocking?: boolean
  /** Timeout in milliseconds; only meaningful in blocking mode. */
  timeoutMs?: number
}

export type Release = () => Promise<void>

/**
 * Acquires an exclusive flock on `<dir>/<app>.lock` by spawning `flock` wrapped
 * around a shell that blocks on stdin. The child holds the lock; writing to
 * its stdin (via the returned `Release`) lets the shell exit cleanly.
 */
export async function stateAcquireLock(
  dir: string,
  app: string,
  opts: LockOptions = {},
): Promise<InternalError | Release> {
  const blocking = opts.blocking ?? true
  const timeoutMs = opts.timeoutMs ?? 30_000
  try {
    await mkdir(dir, { recursive: true, mode: 0o750 })
  } catch (error) {
    return new InternalError(
      `creating lock dir ${dir}: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    )
  }
  const path = join(dir, `${app}.lock`)

  const flags = blocking ? ['-x', '-w', Math.ceil(timeoutMs / 1000).toString()] : ['-x', '-n']
  const command = ['flock', ...flags, path, 'sh', '-c', 'echo READY; read _']
  let proc: ProcessPromise
  try {
    proc = $({ stdio: ['pipe', 'pipe', 'pipe'], quiet: true })`${command}`
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return new InternalError(`start lock process for ${app}: ${message}`, { cause: error })
  }
  const settled = proc.catch(() => undefined)

  const ready = await waitForReady(proc.stdout)
  if (!ready) {
    await proc.kill().catch(() => undefined)
    await settled
    const msg = blocking
      ? `timed out waiting for lock on ${app}`
      : `lock on ${app} is held by another process`
    return new InternalError(msg)
  }

  return async () => {
    proc.stdin.end()
    await settled
  }
}

async function waitForReady(stdout: ProcessPromise['stdout'] | Readable): Promise<boolean> {
  let buf = ''
  for await (const chunk of stdout) {
    buf += chunk.toString()
    if (buf.includes('READY')) {
      return true
    }
  }
  return false
}
