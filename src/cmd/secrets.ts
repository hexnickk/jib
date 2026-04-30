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

/** Loads the shared secrets command context from the managed config. */
async function loadSecretsContext() {
  const loaded = await configLoadContext()
  if (loaded instanceof Error) return loaded
  const { cfg, paths } = loaded
  const secrets: SecretsContext = { secretsDir: paths.secretsDir }
  return { cfg, paths, secrets }
}

const cliSecretsCommands = [
  {
    command: 'secrets set <app> <pair>',
    describe: 'Set a secret (KEY=VALUE)',
    handler: cmdCreateHandler(secretsSetRunCommand),
  } satisfies CommandModule<Record<string, unknown>, { app: string; pair: string }>,
  {
    command: 'secrets list [app]',
    describe: 'Show secrets for an app (or all apps)',
    handler: cmdCreateHandler(secretsListRunCommand),
  } satisfies CommandModule<Record<string, unknown>, { app?: string }>,
  {
    command: 'secrets delete <app> <key>',
    describe: 'Remove a secret key',
    handler: cmdCreateHandler(secretsDeleteRunCommand),
  } satisfies CommandModule<Record<string, unknown>, { app: string; key: string }>,
] satisfies CommandModule<Record<string, unknown>, never>[]

/** Sets a secret key-value pair and returns the mutation payload or typed error. */
async function secretsSetRunCommand(args: ArgumentsCamelCase<{ app: string; pair: string }>) {
  const appName = String(args.app)
  const pair = String(args.pair)
  const loaded = await loadSecretsContext()
  if (loaded instanceof Error) return loaded
  const { cfg, secrets } = loaded
  const appCfg = cfg.apps[appName]
  if (!appCfg) return new CliError('missing_app', `app "${appName}" not found in config`)
  const separator = pair.indexOf('=')
  if (separator < 1) {
    return new CliError('invalid_secret_pair', `invalid format "${pair}" — expected KEY=VALUE`)
  }
  const key = pair.slice(0, separator)
  const value = pair.slice(separator + 1)
  const upsertError = await secretsUpsert(secrets, appName, key, value, appCfg.env_file)
  if (upsertError instanceof Error) return upsertError
  if (cliIsTextOutput()) consola.success(`set ${key} for ${appName}`)
  return { app: appName, key, updated: true }
}

/** Lists secrets for one app or all apps and returns masked entries or typed error. */
async function secretsListRunCommand(args: ArgumentsCamelCase<{ app?: string }>) {
  const requestedApp = typeof args.app === 'string' ? args.app : undefined
  const loaded = await loadSecretsContext()
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
    const status = await secretsCheckApp(secrets, appName, appCfg.env_file)
    if (status instanceof Error) return status
    if (!status.exists) {
      items.push({ app: appName, path: null, entries: [] })
      missingApp = true
      continue
    }
    const entries = await secretsReadMasked(secrets, appName, appCfg.env_file)
    if (entries instanceof Error) return entries
    items.push({ app: appName, path: status.path, entries })
  }

  if (cliIsTextOutput()) {
    for (const item of items) {
      if (!item.path) {
        consola.log(`${item.app} no secrets`)
        continue
      }
      consola.log(`${item.app} ${item.path}`)
      for (const entry of item.entries) consola.log(`  ${entry.key}=${entry.masked}`)
    }
  }

  if (missingApp && requestedApp) {
    return new CliError('missing_secrets', `app "${requestedApp}" has no secrets configured`)
  }
  return { apps: items }
}

/** Deletes a secret key and returns the mutation payload or typed error. */
async function secretsDeleteRunCommand(args: ArgumentsCamelCase<{ app: string; key: string }>) {
  const appName = String(args.app)
  const key = String(args.key)
  const loaded = await loadSecretsContext()
  if (loaded instanceof Error) return loaded
  const { cfg, secrets } = loaded
  const appCfg = cfg.apps[appName]
  if (!appCfg) return new CliError('missing_app', `app "${appName}" not found in config`)
  const removed = await secretsRemove(secrets, appName, key, appCfg.env_file)
  if (removed instanceof Error) return removed
  if (!removed) return new CliError('missing_secret_key', `key "${key}" not found in ${appName}`)
  if (cliIsTextOutput()) consola.success(`deleted ${key} from ${appName}`)
  return { app: appName, key, removed: true }
}

export default cliSecretsCommands
