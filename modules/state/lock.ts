import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { LockError } from './errors.ts'

export interface LockOptions {
  blocking?: boolean
  /** Timeout in milliseconds; only meaningful in blocking mode. */
  timeoutMs?: number
}

export type Release = () => Promise<void>

/**
 * Acquires an exclusive flock on `<dir>/<app>.lock` by spawning `flock` wrapped
 * around a shell that blocks on stdin. The child holds the lock; writing to
 * its stdin (via the returned `Release`) lets the shell exit cleanly. No FFI,
 * no races with Bun's fd handling.
 */
export async function acquireLock(
  dir: string,
  app: string,
  opts: LockOptions = {},
): Promise<LockError | Release> {
  const blocking = opts.blocking ?? true
  const timeoutMs = opts.timeoutMs ?? 30_000
  try {
    await mkdir(dir, { recursive: true, mode: 0o750 })
  } catch (error) {
    return new LockError(
      `creating lock dir ${dir}: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    )
  }
  const path = join(dir, `${app}.lock`)

  const flags = blocking ? ['-x', '-w', Math.ceil(timeoutMs / 1000).toString()] : ['-x', '-n']
  const proc = Bun.spawn(['flock', ...flags, path, 'sh', '-c', 'echo READY; read _'], {
    stdin: 'pipe',
    stdout: 'pipe',
    stderr: 'pipe',
  })

  const ready = await waitForReady(proc)
  if (!ready) {
    try {
      proc.kill()
    } catch {
      // already exited
    }
    await proc.exited.catch(() => undefined)
    const msg = blocking
      ? `timed out waiting for lock on ${app}`
      : `lock on ${app} is held by another process`
    return new LockError(msg)
  }

  return async () => {
    try {
      proc.stdin.end()
    } catch {
      // already closed
    }
    await proc.exited
  }
}

export async function acquire(dir: string, app: string, opts: LockOptions = {}): Promise<Release> {
  const release = await acquireLock(dir, app, opts)
  if (release instanceof LockError) throw release
  return release
}

async function waitForReady(proc: Bun.Subprocess<'pipe', 'pipe', 'pipe'>): Promise<boolean> {
  const reader = proc.stdout.getReader()
  const decoder = new TextDecoder()
  let buf = ''
  try {
    while (true) {
      const { value, done } = await reader.read()
      if (done) return false
      buf += decoder.decode(value)
      if (buf.includes('READY')) return true
    }
  } finally {
    reader.releaseLock()
  }
}
