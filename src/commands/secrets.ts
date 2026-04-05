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
      process.exit(1)
    }
    consola.success(`Secrets set for ${args.app}.`)
  },
})

const checkCmd = defineCommand({
  meta: { name: 'check', description: 'Verify secrets file exists for an app (or all apps)' },
  args: { app: { type: 'positional', required: false } },
  async run({ args }) {
    const { cfg, mgr } = await loadCtx()
    if (args.app) {
      const appCfg = cfg.apps[args.app]
      if (!appCfg) {
        consola.error(`app "${args.app}" not found in config`)
        process.exit(1)
      }
      const status = await mgr.check(args.app, appCfg.env_file)
      if (status.exists) {
        consola.log(`OK       ${args.app}  ${status.path}`)
        return
      }
      consola.log(`MISSING  ${args.app}  ${status.path}`)
      consola.error(`secrets file missing for ${args.app}`)
      process.exit(1)
    }

    const results = await mgr.checkAll(cfg.apps)
    if (results.length === 0) {
      consola.log('No apps configured.')
      return
    }
    let allOK = true
    for (const r of results) {
      if (r.exists) consola.log(`OK       ${r.app}  ${r.path}`)
      else {
        consola.log(`MISSING  ${r.app}  ${r.path}`)
        allOK = false
      }
    }
    if (!allOK) process.exit(1)
  },
})

export default defineCommand({
  meta: { name: 'secrets', description: 'Manage app secrets (bulk file import)' },
  subCommands: { set: setCmd, check: checkCmd },
})
