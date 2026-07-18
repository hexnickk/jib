import { chmod, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { InternalError, NotFoundError } from '@jib/errors'

export interface SecretsContext {
  secretsDir: string
}

export interface AppSecretStatus {
  app: string
  exists: boolean
  path: string
}

export interface MaskedSecretEntry {
  key: string
  masked: string
}

const FILE_MODE = 0o640
const DIR_MODE = 0o750

/** Splits an env file into mutable lines plus a key-to-line index. */
function parseEnv(content: string): { lines: string[]; entries: Map<string, number> } {
  const lines = content.split('\n')
  const entries = new Map<string, number>()
  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i]?.trim() ?? ''
    if (!trimmed || trimmed.startsWith('#')) {
      continue
    }
    const eq = trimmed.indexOf('=')
    if (eq > 0) {
      entries.set(trimmed.slice(0, eq), i)
    }
  }
  return { lines, entries }
}

/** Detects missing-file fs errors that should be treated as absence, not failure. */
function isMissingError(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT'
}

/** Reads an env file when present and returns a typed error for other read failures. */
async function readEnvIfPresent(path: string): Promise<string | InternalError | undefined> {
  try {
    return await readFile(path, 'utf8')
  } catch (error) {
    if (isMissingError(error)) {
      return undefined
    }
    return new InternalError(`reading secrets ${path}`, { cause: error })
  }
}

/** Ensures the per-app secrets directory exists with the managed permissions. */
async function ensureAppDir(path: string): Promise<undefined | InternalError> {
  try {
    await mkdir(path, { recursive: true, mode: DIR_MODE })
    await chmod(path, DIR_MODE)
    return
  } catch (error) {
    return new InternalError(`writing secrets ${path}`, { cause: error })
  }
}

/** Writes one managed secrets file and reapplies the expected mode. */
async function writeSecure(path: string, content: string): Promise<undefined | InternalError> {
  try {
    await writeFile(path, content, { mode: FILE_MODE })
    await chmod(path, FILE_MODE)
    return
  } catch (error) {
    return new InternalError(`writing secrets ${path}`, { cause: error })
  }
}

/** Checks whether an app secrets file exists without treating absence as failure. */
export async function secretsCheckApp(
  ctx: SecretsContext,
  app: string,
): Promise<AppSecretStatus | InternalError> {
  const path = join(ctx.secretsDir, app, '.env')
  try {
    await stat(path)
    return { app, exists: true, path }
  } catch (error) {
    if (isMissingError(error)) {
      return { app, exists: false, path }
    }
    return new InternalError(`checking secrets ${path}`, { cause: error })
  }
}

/** Reads one app secrets file and returns masked key previews for display. */
export async function secretsReadMasked(
  ctx: SecretsContext,
  app: string,
): Promise<MaskedSecretEntry[] | InternalError | NotFoundError> {
  const path = join(ctx.secretsDir, app, '.env')
  const content = await readEnvIfPresent(path)
  if (content instanceof Error) {
    return content
  }
  if (content === undefined) {
    return new NotFoundError(`secrets ${path} not found`)
  }
  const { lines, entries } = parseEnv(content)
  return [...entries.entries()].map(([key, idx]) => {
    const line = lines[idx] ?? ''
    const eq = line.indexOf('=')
    const val = eq >= 0 ? line.slice(eq + 1) : ''
    const visible = val.length >= 3 ? val.slice(0, 3) : ''
    return { key, masked: `${visible}***` }
  })
}

/** Inserts or updates one secret key in an app env file. */
export async function secretsUpsert(
  ctx: SecretsContext,
  app: string,
  key: string,
  value: string,
): Promise<undefined | InternalError> {
  const appDir = join(ctx.secretsDir, app)
  const ensured = await ensureAppDir(appDir)
  if (ensured instanceof Error) {
    return ensured
  }
  const path = join(ctx.secretsDir, app, '.env')
  const existing = await readEnvIfPresent(path)
  if (existing instanceof Error) {
    return existing
  }
  const { lines, entries } = parseEnv(existing ?? '')
  const line = `${key}=${value}`
  const idx = entries.get(key)
  if (idx !== undefined) {
    lines[idx] = line
  } else if (lines.length > 0 && lines[lines.length - 1] === '') {
    lines[lines.length - 1] = line
    lines.push('')
  } else {
    lines.push(line)
  }
  return writeSecure(path, lines.join('\n'))
}

/** Removes one secret key from an app env file, returning false when absent. */
export async function secretsRemove(
  ctx: SecretsContext,
  app: string,
  key: string,
): Promise<boolean | InternalError> {
  const path = join(ctx.secretsDir, app, '.env')
  const content = await readEnvIfPresent(path)
  if (content instanceof Error) {
    return content
  }
  if (content === undefined) {
    return false
  }
  const { lines, entries } = parseEnv(content)
  const idx = entries.get(key)
  if (idx === undefined) {
    return false
  }
  lines.splice(idx, 1)
  const written = await writeSecure(path, lines.join('\n'))
  if (written instanceof Error) {
    return written
  }
  return true
}

/** Removes the entire managed secrets directory for one app. */
export async function secretsRemoveApp(
  ctx: SecretsContext,
  app: string,
): Promise<undefined | InternalError> {
  const path = join(ctx.secretsDir, app)
  try {
    await rm(path, { recursive: true, force: true })
    return
  } catch (error) {
    return new InternalError(`removing secrets ${path}`, { cause: error })
  }
}
