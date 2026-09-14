import { randomUUID } from 'node:crypto'
import { chmod, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { InternalError, type JibError } from '@jib/errors'
import { type Paths, pathsCredsPath, pathsEnsureCredsDirResult } from '@jib/paths'
import { stateAcquireLock } from '@jib/state'

export interface NotificationsContext {
  paths: Paths
}

// Retain the lock inode on removal: unlinking it could let concurrent senders bypass flock.
export async function notificationsWithLock<Value>(
  ctx: NotificationsContext,
  run: () => Promise<Value>,
): Promise<Value | JibError> {
  const release = await stateAcquireLock(join(ctx.paths.locksDir, '_jib'), 'notifications')
  if (release instanceof Error) {
    return release
  }
  try {
    return await run()
  } catch (error) {
    return new InternalError('notification operation failed', { cause: error })
  } finally {
    await release()
  }
}

export async function notificationsReadToken(ctx: NotificationsContext) {
  try {
    return (await readFile(pathsCredsPath(ctx.paths, 'notifications', 'telegram'), 'utf8')).trim()
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return undefined
    }
    return new InternalError('cannot read Telegram bot token', { cause: error })
  }
}

export async function notificationsWriteToken(
  ctx: NotificationsContext,
  token: string | undefined,
) {
  const path = pathsCredsPath(ctx.paths, 'notifications', 'telegram')
  if (token === undefined) {
    try {
      await rm(path, { force: true })
      return undefined
    } catch (error) {
      return new InternalError('cannot remove Telegram bot token', { cause: error })
    }
  }
  const dir = await pathsEnsureCredsDirResult(ctx.paths, 'notifications')
  if (dir instanceof Error) {
    return dir
  }
  return notificationsWriteFile(path, token)
}

/** Atomic replacement for the secret and daily deduplication marker. */
export async function notificationsWriteFile(path: string, content: string) {
  const tmp = `${path}.${randomUUID()}.tmp`
  try {
    await writeFile(tmp, content, { mode: 0o640 })
    await chmod(tmp, 0o640)
    await rename(tmp, path)
    return undefined
  } catch (error) {
    await rm(tmp, { force: true }).catch(() => undefined)
    return new InternalError('cannot write notification file', { cause: error })
  }
}
