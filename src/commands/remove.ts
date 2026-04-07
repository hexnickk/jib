import { withBus } from '@jib/bus'
import { writeConfig } from '@jib/config'
import { composeFor } from '@jib/docker'
import { SUBJECTS, emitAndWait } from '@jib/rpc'
import { promptConfirm } from '@jib/tui'
import { defineCommand } from 'citty'
import { consola } from 'consola'
import { loadAppOrExit } from './ctx.ts'

/**
 * `jib remove <app>` — reverse of add. Order matters:
 *   1. `cmd.nginx.release` — stop accepting traffic first
 *   2. `docker compose down` — stop the app itself
 *   3. `cmd.repo.remove` — cleanup gitsitter's workdir
 *   4. drop the config entry
 *
 * Every step is best-effort: if one fails we log and continue so the
 * operator can finish teardown by hand rather than being left with a
 * half-removed app.
 */

const DEFAULT_TIMEOUT_MS = 2 * 60_000

export default defineCommand({
  meta: { name: 'remove', description: 'Remove an app completely' },
  args: {
    app: { type: 'positional', required: true },
    force: { type: 'boolean', description: 'Skip confirmation prompt' },
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

    try {
      await withBus(async (bus) => {
        await emitAndWait(
          bus,
          SUBJECTS.cmd.nginxRelease,
          { app: args.app },
          { success: SUBJECTS.evt.nginxReleased, failure: SUBJECTS.evt.nginxFailed },
          SUBJECTS.evt.nginxProgress,
          { source: 'cli', timeoutMs: DEFAULT_TIMEOUT_MS },
        )
        consola.info('nginx routes released')
      })
    } catch (err) {
      consola.warn(`nginx release: ${err instanceof Error ? err.message : String(err)}`)
    }

    try {
      const compose = composeFor(cfg, paths, args.app)
      await compose.down(false)
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
