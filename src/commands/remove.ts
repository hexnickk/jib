import { type Config, writeConfig } from '@jib/config'
import { type ModuleContext, createLogger } from '@jib/core'
import { SUBJECTS, emitAndWait } from '@jib/rpc'
import { promptConfirm } from '@jib/tui'
import { defineCommand } from 'citty'
import { consola } from 'consola'
import { withBus } from '../bus-client.ts'
import { runSetupHooks } from '../setup-hooks.ts'
import { composeFor } from './_compose.ts'
import { loadAppOrExit } from './_ctx.ts'

/**
 * `jib remove <app>` — reverse of add. Runs hook teardown in reverse order,
 * brings containers down, asks gitsitter to clean its workdir, then drops
 * the config entry. Every step is best-effort: even if an integration
 * fails, we keep going so the operator can finish removal by hand.
 */

const DEFAULT_TIMEOUT_MS = 2 * 60_000

export default defineCommand({
  meta: { name: 'remove', description: 'Remove an app completely' },
  args: {
    app: { type: 'positional', required: true },
    force: { type: 'boolean', description: 'Skip confirmation prompt' },
    volumes: { type: 'boolean', description: 'Also remove Docker volumes' },
  },
  async run({ args }) {
    const { cfg, paths } = await loadAppOrExit(args.app)
    // loadAppOrExit guarantees cfg.apps[args.app] exists.
    const appCfg = cfg.apps[args.app] as NonNullable<(typeof cfg.apps)[string]>

    if (!args.force) {
      const ok = await promptConfirm({
        message: `Remove app "${args.app}" (${appCfg.domains.map((d) => d.host).join(', ')})?`,
        initialValue: false,
      })
      if (!ok) {
        consola.info('aborted')
        return
      }
    }

    const ctx: ModuleContext<Config> = {
      config: cfg,
      logger: createLogger('remove'),
      paths,
    }
    await runSetupHooks(ctx, args.app, 'remove')

    try {
      const compose = composeFor(cfg, paths, args.app)
      await compose.down(Boolean(args.volumes))
      consola.info('containers stopped')
    } catch (err) {
      consola.warn(`compose down: ${err instanceof Error ? err.message : String(err)}`)
    }

    try {
      await withBus(async (bus) => {
        await emitAndWait(
          bus,
          SUBJECTS.cmd.repoRemove,
          { app: args.app },
          { success: SUBJECTS.evt.repoRemoved, failure: SUBJECTS.evt.repoFailed },
          undefined,
          { source: 'cli', timeoutMs: DEFAULT_TIMEOUT_MS },
        )
      })
    } catch (err) {
      consola.warn(`repo cleanup: ${err instanceof Error ? err.message : String(err)}`)
    }

    const nextApps = { ...cfg.apps }
    delete nextApps[args.app]
    await writeConfig(paths.configFile, { ...cfg, apps: nextApps })
    consola.success(`removed ${args.app}`)
  },
})
