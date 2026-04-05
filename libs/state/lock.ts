import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { LockError } from '@jib/core'

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
export async function acquire(dir: string, app: string, opts: LockOptions = {}): Promise<Release> {
  const blocking = opts.blocking ?? true
  const timeoutMs = opts.timeoutMs ?? 30_000
  await mkdir(dir, { recursive: true, mode: 0o750 })
  const path = join(dir, `${app}.lock`)

  const flags = blocking ? ['-x', '-w', Math.ceil(timeoutMs / 1000).toString()] : ['-x', '-n']
  // The inner shell prints READY once the lock is held, then blocks on `read`
  // until we close its stdin. That's our cross-platform wait primitive.
  const proc = Bun.spawn(['flock', ...flags, path, 'sh', '-c', 'echo READY; read _'], {
    stdin: 'pipe',
    stdout: 'pipe',
    stderr: 'pipe',
  })

  const ready = await waitForReady(proc)
  if (!ready) {
    // The child is either still running (stdout closed without READY is
    // unexpected) or already exited without acquiring the lock. Either way
    // kill it explicitly and wait for it to reap so we don't leak a zombie
    // process — a tight loop of failed `acquire()` calls would otherwise
    // burn through PIDs.
    try {
      proc.kill()
    } catch {
      // already exited
    }
    await proc.exited.catch(() => undefined)
    const msg = blocking
      ? `timed out waiting for lock on ${app}`
      : `lock on ${app} is held by another process`
    throw new LockError(msg)
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
    // Always release the reader lock — otherwise callers can't drain stdout
    // or close the stream on the failure path.
    reader.releaseLock()
  }
}
