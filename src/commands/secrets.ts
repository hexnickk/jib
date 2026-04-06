import { SecretsManager } from '@jib/secrets'
import { defineCommand } from 'citty'
import { consola } from 'consola'
import { loadAppConfig } from './_ctx.ts'

/**
 * `jib secrets set|check` — bulk env-file management for apps. Replaces
 * Go's `registerSecretsCommands`. No bus: secrets live on local disk only.
 */

async function loadCtx() {
  const { cfg, paths } = await loadAppConfig()
  const mgr = new SecretsManager(paths.secretsDir)
  return { cfg, paths, mgr }
}

const setCmd = defineCommand({
  meta: { name: 'set', description: 'Import env vars from a file (bulk replace)' },
  args: {
    app: { type: 'positional', required: true },
    file: { type: 'string', required: true, description: 'Path to secrets file' },
  },
  async run({ args }) {
    const { cfg, mgr } = await loadCtx()
    const appCfg = cfg.apps[args.app]
    if (!appCfg) {
      consola.error(`app "${args.app}" not found in config`)
      process.exit(1)
    }
    try {
      await mgr.set(args.app, args.file, appCfg.env_file)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      consola.error(`setting secrets for ${args.app}: ${msg}`)
      consola.info('expected .env format: KEY=value, one per line')
      process.exit(1)
    }
    consola.success(`secrets set for ${args.app}`)
  },
})

const checkCmd = defineCommand({
  meta: { name: 'check', description: 'Show secrets status for an app (or all apps)' },
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
        consola.log(`${name} missing`)
        hasMissing = true
        continue
      }
      consola.log(`${name} ${status.path}`)
      const entries = await mgr.readMasked(name, appCfg.env_file)
      for (const e of entries) {
        consola.log(`  ${e.key}=${e.masked}`)
      }
    }
    if (hasMissing) process.exit(1)
  },
})

export default defineCommand({
  meta: { name: 'secrets', description: 'Manage app secrets (bulk file import)' },
  subCommands: { set: setCmd, check: checkCmd },
})
