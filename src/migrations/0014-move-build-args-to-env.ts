import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { configLoad, configWrite } from '@jib/config'
import { InternalError, type JibError } from '@jib/errors'
import { type SecretsContext, secretsUpsert } from '@jib/secrets'
import { parse } from 'yaml'
import type { JibMigration, MigrationContext } from './types.ts'

interface LegacyAppConfig {
  build_args?: unknown
  env_file?: unknown
}

export const m0014_move_build_args_to_env: JibMigration = {
  id: '0014_move_build_args_to_env',
  description: 'move app build_args values into managed env files and remove env config fields',
  async up(ctx) {
    return await moveBuildArgsToEnv(ctx)
  },
}

/** Moves legacy build args to env files and removes obsolete config fields. */
export async function moveBuildArgsToEnv(ctx: MigrationContext): Promise<JibError | undefined> {
  const legacyApps = await readLegacyAppEnvFields(ctx.paths.configFile)
  if (legacyApps instanceof Error) {
    return legacyApps
  }
  if (legacyApps.size === 0) {
    return
  }

  const cfg = await configLoad(ctx.paths.configFile)
  if (cfg instanceof Error) {
    return cfg
  }

  const secrets: SecretsContext = { secretsDir: ctx.paths.secretsDir }
  for (const [appName, legacy] of legacyApps) {
    if (!cfg.apps[appName]) {
      continue
    }
    for (const [key, value] of Object.entries(legacy.buildArgs)) {
      const hasKey = await envFileHasKey(secrets, appName, key)
      if (hasKey instanceof Error) {
        return hasKey
      }
      if (hasKey) {
        continue
      }
      const upsertError = await secretsUpsert(secrets, appName, key, value)
      if (upsertError instanceof Error) {
        return upsertError
      }
    }
  }

  const writeError = await configWrite(ctx.paths.configFile, cfg)
  return writeError instanceof Error ? writeError : undefined
}

/** Reads legacy env/build fields from raw YAML before the current schema strips unknown fields. */
async function readLegacyAppEnvFields(
  configFile: string,
): Promise<Map<string, { buildArgs: Record<string, string> }> | InternalError> {
  let raw: string
  try {
    raw = await readFile(configFile, 'utf8')
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return new InternalError(`read legacy app config: ${message}`, { cause: error })
  }
  try {
    const doc = parse(raw) as { apps?: unknown } | null
    const apps = doc && typeof doc.apps === 'object' && doc.apps ? doc.apps : {}
    const out = new Map<string, { buildArgs: Record<string, string> }>()
    for (const [appName, appValue] of Object.entries(apps as Record<string, LegacyAppConfig>)) {
      if (!appValue || typeof appValue !== 'object') {
        continue
      }
      const buildArgs = stringRecord(appValue.build_args) ?? {}
      const hasLegacyEnvFile = 'env_file' in appValue
      if (!hasLegacyEnvFile && Object.keys(buildArgs).length === 0) {
        continue
      }
      out.set(appName, { buildArgs })
    }
    return out
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return new InternalError(`parse legacy app config: ${message}`, { cause: error })
  }
}

/** Returns a string-only record or undefined for malformed legacy values. */
function stringRecord(value: unknown): Record<string, string> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined
  }
  const entries = Object.entries(value).filter(
    (entry): entry is [string, string] => typeof entry[1] === 'string',
  )
  return Object.fromEntries(entries)
}

/** Returns whether an env file defines a key; a missing env file is treated as empty. */
async function envFileHasKey(
  secrets: SecretsContext,
  appName: string,
  key: string,
): Promise<boolean | InternalError> {
  try {
    const raw = await readFile(join(secrets.secretsDir, appName, '.env'), 'utf8')
    return raw
      .split('\n')
      .some((line) => line.trimStart().startsWith(`${key}=`) && !line.trimStart().startsWith('#'))
  } catch (error) {
    if (typeof error === 'object' && error && 'code' in error && error.code === 'ENOENT') {
      return false
    }
    const message = error instanceof Error ? error.message : String(error)
    return new InternalError(`read ${appName} environment: ${message}`, { cause: error })
  }
}
