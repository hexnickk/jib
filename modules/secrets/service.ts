import { chmod, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
  SecretsReadError,
  SecretsRemoveAppError,
  SecretsStatError,
  SecretsWriteError,
} from './errors.ts'

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

function envFileName(name?: string): string {
  return name && name !== '' ? name : '.env'
}

function parseEnv(content: string): { lines: string[]; entries: Map<string, number> } {
  const lines = content.split('\n')
  const entries = new Map<string, number>()
  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i]?.trim() ?? ''
    if (!trimmed || trimmed.startsWith('#')) continue
    const eq = trimmed.indexOf('=')
    if (eq > 0) entries.set(trimmed.slice(0, eq), i)
  }
  return { lines, entries }
}

function isMissingError(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT'
}

async function readEnvIfPresent(path: string): Promise<string | SecretsReadError | undefined> {
  try {
    return await readFile(path, 'utf8')
  } catch (error) {
    if (isMissingError(error)) return undefined
    return new SecretsReadError(path, { cause: error })
  }
}

async function ensureAppDir(path: string): Promise<undefined | SecretsWriteError> {
  try {
    await mkdir(path, { recursive: true, mode: DIR_MODE })
    await chmod(path, DIR_MODE)
    return
  } catch (error) {
    return new SecretsWriteError(path, { cause: error })
  }
}

async function writeSecure(path: string, content: string): Promise<undefined | SecretsWriteError> {
  try {
    await writeFile(path, content, { mode: FILE_MODE })
    await chmod(path, FILE_MODE)
    return
  } catch (error) {
    return new SecretsWriteError(path, { cause: error })
  }
}

export function secretsEnvPath(ctx: SecretsContext, app: string, envFile?: string): string {
  return join(ctx.secretsDir, app, envFileName(envFile))
}

export async function secretsCheckApp(
  ctx: SecretsContext,
  app: string,
  envFile?: string,
): Promise<AppSecretStatus | SecretsStatError> {
  const path = secretsEnvPath(ctx, app, envFile)
  try {
    await stat(path)
    return { app, exists: true, path }
  } catch (error) {
    if (isMissingError(error)) return { app, exists: false, path }
    return new SecretsStatError(path, { cause: error })
  }
}

export async function secretsReadMasked(
  ctx: SecretsContext,
  app: string,
  envFile?: string,
): Promise<MaskedSecretEntry[] | SecretsReadError> {
  const path = secretsEnvPath(ctx, app, envFile)
  const content = await readEnvIfPresent(path)
  if (content instanceof SecretsReadError) return content
  if (content === undefined) return new SecretsReadError(path)
  const { lines, entries } = parseEnv(content)
  return [...entries.entries()].map(([key, idx]) => {
    const line = lines[idx] ?? ''
    const eq = line.indexOf('=')
    const val = eq >= 0 ? line.slice(eq + 1) : ''
    const visible = val.length >= 3 ? val.slice(0, 3) : ''
    return { key, masked: `${visible}***` }
  })
}

export async function secretsUpsert(
  ctx: SecretsContext,
  app: string,
  key: string,
  value: string,
  envFile?: string,
): Promise<undefined | SecretsReadError | SecretsWriteError> {
  const appDir = join(ctx.secretsDir, app)
  const ensured = await ensureAppDir(appDir)
  if (ensured instanceof SecretsWriteError) return ensured
  const path = secretsEnvPath(ctx, app, envFile)
  const existing = await readEnvIfPresent(path)
  if (existing instanceof SecretsReadError) return existing
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

export async function secretsRemove(
  ctx: SecretsContext,
  app: string,
  key: string,
  envFile?: string,
): Promise<boolean | SecretsReadError | SecretsWriteError> {
  const path = secretsEnvPath(ctx, app, envFile)
  const content = await readEnvIfPresent(path)
  if (content instanceof SecretsReadError) return content
  if (content === undefined) return false
  const { lines, entries } = parseEnv(content)
  const idx = entries.get(key)
  if (idx === undefined) return false
  lines.splice(idx, 1)
  const written = await writeSecure(path, lines.join('\n'))
  if (written instanceof SecretsWriteError) return written
  return true
}

export async function secretsRemoveApp(
  ctx: SecretsContext,
  app: string,
): Promise<undefined | SecretsRemoveAppError> {
  const path = join(ctx.secretsDir, app)
  try {
    await rm(path, { recursive: true, force: true })
    return
  } catch (error) {
    return new SecretsRemoveAppError(path, { cause: error })
  }
}
