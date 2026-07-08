import { CliError, cliIsTextOutput } from '@jib/cli'
import { configLoadContext } from '@jib/config'
import {
  type SecretsContext,
  secretsCheckApp,
  secretsReadMasked,
  secretsRemove,
  secretsUpsert,
} from '@jib/secrets'
import { consola } from 'consola'
import type { ArgumentsCamelCase, CommandModule } from 'yargs'
import { cmdCreateHandler } from './handler.ts'

/** Loads the shared env command context from the managed config. */
async function loadEnvContext() {
  const loaded = await configLoadContext()
  if (loaded instanceof Error) return loaded
  const { cfg, paths } = loaded
  const secrets: SecretsContext = { secretsDir: paths.secretsDir }
  return { cfg, paths, secrets }
}

const cliEnvCommands = [
  {
    command: 'env',
    describe: 'Manage app environment variables',
    builder: (parser) =>
      parser
        .command({
          command: 'set <app> <pair>',
          describe: 'Set an environment variable (KEY=VALUE)',
          handler: cmdCreateHandler(envSetRunCommand),
        } satisfies CommandModule<Record<string, unknown>, { app: string; pair: string }>)
        .command({
          command: 'list [app]',
          describe: 'Show environment variables for an app (or all apps)',
          handler: cmdCreateHandler(envListRunCommand),
        } satisfies CommandModule<Record<string, unknown>, { app?: string }>)
        .command({
          command: 'delete <app> <key>',
          describe: 'Remove an environment variable',
          handler: cmdCreateHandler(envDeleteRunCommand),
        } satisfies CommandModule<Record<string, unknown>, { app: string; key: string }>)
        .demandCommand(1),
    handler: () => undefined,
  },
] satisfies CommandModule<Record<string, unknown>, unknown>[]

/** Sets an env key-value pair and returns the mutation payload or typed error. */
async function envSetRunCommand(args: ArgumentsCamelCase<{ app: string; pair: string }>) {
  const appName = String(args.app)
  const pair = String(args.pair)
  const loaded = await loadEnvContext()
  if (loaded instanceof Error) return loaded
  const { cfg, secrets } = loaded
  const appCfg = cfg.apps[appName]
  if (!appCfg) return new CliError('missing_app', `app "${appName}" not found in config`)
  const separator = pair.indexOf('=')
  if (separator < 1) {
    return new CliError('invalid_env_pair', `invalid format "${pair}" — expected KEY=VALUE`)
  }
  const key = pair.slice(0, separator)
  const value = pair.slice(separator + 1)
  const upsertError = await secretsUpsert(secrets, appName, key, value)
  if (upsertError instanceof Error) return upsertError
  if (cliIsTextOutput()) consola.success(`set ${key} for ${appName}`)
  return { app: appName, key, updated: true }
}

/** Lists env variables for one app or all apps and returns masked entries or typed error. */
async function envListRunCommand(args: ArgumentsCamelCase<{ app?: string }>) {
  const requestedApp = typeof args.app === 'string' ? args.app : undefined
  const loaded = await loadEnvContext()
  if (loaded instanceof Error) return loaded
  const { cfg, secrets } = loaded
  const apps = requestedApp ? [requestedApp] : Object.keys(cfg.apps).sort()
  if (apps.length === 0) {
    if (cliIsTextOutput()) consola.log('no apps configured')
    return { apps: [] }
  }

  const items: {
    app: string
    path: string | null
    entries: { key: string; masked: string }[]
  }[] = []
  let missingApp = false
  for (const appName of apps) {
    const appCfg = cfg.apps[appName]
    if (!appCfg) return new CliError('missing_app', `app "${appName}" not found in config`)
    const status = await secretsCheckApp(secrets, appName)
    if (status instanceof Error) return status
    if (!status.exists) {
      items.push({ app: appName, path: null, entries: [] })
      missingApp = true
      continue
    }
    const entries = await secretsReadMasked(secrets, appName)
    if (entries instanceof Error) return entries
    items.push({ app: appName, path: status.path, entries })
  }

  if (cliIsTextOutput()) {
    for (const item of items) {
      if (!item.path) {
        consola.log(`${item.app} no env`)
        continue
      }
      consola.log(`${item.app} ${item.path}`)
      for (const entry of item.entries) consola.log(`  ${entry.key}=${entry.masked}`)
    }
  }

  if (missingApp && requestedApp) {
    return new CliError('missing_env', `app "${requestedApp}" has no env configured`)
  }
  return { apps: items }
}

/** Deletes an env key and returns the mutation payload or typed error. */
async function envDeleteRunCommand(args: ArgumentsCamelCase<{ app: string; key: string }>) {
  const appName = String(args.app)
  const key = String(args.key)
  const loaded = await loadEnvContext()
  if (loaded instanceof Error) return loaded
  const { cfg, secrets } = loaded
  const appCfg = cfg.apps[appName]
  if (!appCfg) return new CliError('missing_app', `app "${appName}" not found in config`)
  const removed = await secretsRemove(secrets, appName, key)
  if (removed instanceof Error) return removed
  if (!removed) return new CliError('missing_env_key', `key "${key}" not found in ${appName}`)
  if (cliIsTextOutput()) consola.success(`deleted ${key} from ${appName}`)
  return { app: appName, key, removed: true }
}

export default cliEnvCommands
