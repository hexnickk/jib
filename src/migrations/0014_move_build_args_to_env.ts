import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { configLoad, configWrite } from '@jib/config'
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
    await moveBuildArgsToEnv(ctx)
  },
}

/** Moves legacy app.build_args values into app env files and rewrites config without env fields. */
export async function moveBuildArgsToEnv(ctx: MigrationContext): Promise<void> {
  const legacyApps = await readLegacyAppEnvFields(ctx.paths.configFile)
  if (legacyApps.size === 0) return

  const cfg = await configLoad(ctx.paths.configFile)
  if (cfg instanceof Error) throw cfg

  const secrets: SecretsContext = { secretsDir: ctx.paths.secretsDir }
  for (const [appName, legacy] of legacyApps) {
    if (!cfg.apps[appName]) continue
    for (const [key, value] of Object.entries(legacy.buildArgs)) {
      if (await envFileHasKey(secrets, appName, key)) continue
      const upsertError = await secretsUpsert(secrets, appName, key, value)
      if (upsertError instanceof Error) throw upsertError
    }
  }

  const writeError = await configWrite(ctx.paths.configFile, cfg)
  if (writeError instanceof Error) throw writeError
}

/** Reads legacy env/build fields from raw YAML before the current schema strips unknown fields. */
async function readLegacyAppEnvFields(
  configFile: string,
): Promise<Map<string, { buildArgs: Record<string, string> }>> {
  const raw = await readFile(configFile, 'utf8')
  const doc = parse(raw) as { apps?: unknown } | null
  const apps = doc && typeof doc.apps === 'object' && doc.apps ? doc.apps : {}
  const out = new Map<string, { buildArgs: Record<string, string> }>()
  for (const [appName, appValue] of Object.entries(apps as Record<string, LegacyAppConfig>)) {
    const buildArgs = stringRecord(appValue.build_args) ?? {}
    const hasLegacyEnvFile = 'env_file' in appValue
    if (!hasLegacyEnvFile && Object.keys(buildArgs).length === 0) continue
    out.set(appName, { buildArgs })
  }
  return out
}

/** Returns a string-only record or undefined for malformed legacy values. */
function stringRecord(value: unknown): Record<string, string> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const entries = Object.entries(value).filter(
    (entry): entry is [string, string] => typeof entry[1] === 'string',
  )
  return Object.fromEntries(entries)
}

/** Returns whether the app env file already defines key; missing env files are empty. */
async function envFileHasKey(
  secrets: SecretsContext,
  appName: string,
  key: string,
): Promise<boolean> {
  try {
    const raw = await readFile(join(secrets.secretsDir, appName, '.env'), 'utf8')
    return raw
      .split('\n')
      .some((line) => line.trimStart().startsWith(`${key}=`) && !line.trimStart().startsWith('#'))
  } catch (error) {
    if (typeof error === 'object' && error && 'code' in error && error.code === 'ENOENT') {
      return false
    }
    throw error
  }
}
