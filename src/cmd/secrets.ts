import { CliError, cliIsTextOutput } from '@jib/cli'
import { loadAppConfig } from '@jib/config'
import { SecretsManager } from '@jib/secrets'
import { consola } from 'consola'
import type { CliCommand } from './command.ts'

/** Loads the shared secrets command context from the managed config. */
async function loadSecretsContext() {
  const { cfg, paths } = await loadAppConfig()
  const manager = new SecretsManager(paths.secretsDir)
  return { cfg, paths, manager }
}

const cliSecretsCommands = [
  {
    command: 'secrets set <app> <pair>',
    describe: 'Set a secret (KEY=VALUE)',
    async run(args) {
      const appName = String(args.app)
      const pair = String(args.pair)
      const { cfg, manager } = await loadSecretsContext()
      const appCfg = cfg.apps[appName]
      if (!appCfg) return new CliError('missing_app', `app "${appName}" not found in config`)
      const separator = pair.indexOf('=')
      if (separator < 1) {
        return new CliError('invalid_secret_pair', `invalid format "${pair}" — expected KEY=VALUE`)
      }
      const key = pair.slice(0, separator)
      const value = pair.slice(separator + 1)
      await manager.upsert(appName, key, value, appCfg.env_file)
      if (cliIsTextOutput()) consola.success(`set ${key} for ${appName}`)
      return { app: appName, key, updated: true }
    },
  },
  {
    command: 'secrets list [app]',
    describe: 'Show secrets for an app (or all apps)',
    async run(args) {
      const requestedApp = typeof args.app === 'string' ? args.app : undefined
      const { cfg, manager } = await loadSecretsContext()
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
        const status = await manager.check(appName, appCfg.env_file)
        if (!status.exists) {
          items.push({ app: appName, path: null, entries: [] })
          missingApp = true
          continue
        }
        const entries = await manager.readMasked(appName, appCfg.env_file)
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
    },
  },
  {
    command: 'secrets delete <app> <key>',
    describe: 'Remove a secret key',
    async run(args) {
      const appName = String(args.app)
      const key = String(args.key)
      const { cfg, manager } = await loadSecretsContext()
      const appCfg = cfg.apps[appName]
      if (!appCfg) return new CliError('missing_app', `app "${appName}" not found in config`)
      const removed = await manager.remove(appName, key, appCfg.env_file)
      if (!removed)
        return new CliError('missing_secret_key', `key "${key}" not found in ${appName}`)
      if (cliIsTextOutput()) consola.success(`deleted ${key} from ${appName}`)
      return { app: appName, key, removed: true }
    },
  },
] satisfies CliCommand[]

export default cliSecretsCommands
