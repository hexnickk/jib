import { SecretsManager } from '@jib/secrets'
import { defineCommand } from 'citty'
import { consola } from 'consola'
import { loadAppConfig } from './ctx.ts'

async function loadCtx() {
  const { cfg, paths } = await loadAppConfig()
  const mgr = new SecretsManager(paths.secretsDir)
  return { cfg, paths, mgr }
}

const setCmd = defineCommand({
  meta: { name: 'set', description: 'Set a secret (KEY=VALUE)' },
  args: {
    app: { type: 'positional', required: true, description: 'App name' },
    pair: { type: 'positional', required: true, description: 'KEY=VALUE pair' },
  },
  async run({ args }) {
    const { cfg, mgr } = await loadCtx()
    const appCfg = cfg.apps[args.app]
    if (!appCfg) {
      consola.error(`app "${args.app}" not found in config`)
      process.exit(1)
    }
    const eq = args.pair.indexOf('=')
    if (eq < 1) {
      consola.error(`invalid format "${args.pair}" — expected KEY=VALUE`)
      process.exit(1)
    }
    const key = args.pair.slice(0, eq)
    const value = args.pair.slice(eq + 1)
    await mgr.upsert(args.app, key, value, appCfg.env_file)
    consola.success(`set ${key} for ${args.app}`)
  },
})

const listCmd = defineCommand({
  meta: { name: 'list', description: 'Show secrets for an app (or all apps)' },
  args: { app: { type: 'positional', required: false } },
  async run({ args }) {
    const { cfg, mgr } = await loadCtx()
    const apps = args.app ? [args.app] : Object.keys(cfg.apps).sort()
    if (apps.length === 0) {
      consola.log('no apps configured')
      return
    }
    let hasMissing = false
    for (const name of apps) {
      const appCfg = cfg.apps[name]
      if (!appCfg) {
        consola.error(`app "${name}" not found in config`)
        process.exit(1)
      }
      const status = await mgr.check(name, appCfg.env_file)
      if (!status.exists) {
        consola.log(`${name} no secrets`)
        hasMissing = true
        continue
      }
      consola.log(`${name} ${status.path}`)
      const entries = await mgr.readMasked(name, appCfg.env_file)
      for (const e of entries) {
        consola.log(`  ${e.key}=${e.masked}`)
      }
    }
    if (hasMissing && args.app) process.exit(1)
  },
})

const deleteCmd = defineCommand({
  meta: { name: 'delete', description: 'Remove a secret key' },
  args: {
    app: { type: 'positional', required: true, description: 'App name' },
    key: { type: 'positional', required: true, description: 'Secret key to remove' },
  },
  async run({ args }) {
    const { cfg, mgr } = await loadCtx()
    const appCfg = cfg.apps[args.app]
    if (!appCfg) {
      consola.error(`app "${args.app}" not found in config`)
      process.exit(1)
    }
    const removed = await mgr.remove(args.app, args.key, appCfg.env_file)
    if (removed) consola.success(`deleted ${args.key} from ${args.app}`)
    else {
      consola.warn(`key "${args.key}" not found in ${args.app}`)
      process.exit(1)
    }
  },
})

export default defineCommand({
  meta: { name: 'secrets', description: 'Manage app secrets' },
  subCommands: { set: setCmd, list: listCmd, delete: deleteCmd },
})
