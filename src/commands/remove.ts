import { withBus } from '@jib/bus'
import { loadAppOrExit, writeConfig } from '@jib/config'
import { canPrompt, isTextOutput } from '@jib/core'
import { composeFor } from '@jib/docker'
import { SUBJECTS, emitAndWait } from '@jib/rpc'
import { removeSource } from '@jib/sources'
import { promptConfirm } from '@jib/tui'
import { defineCommand } from 'citty'
import { consola } from 'consola'
import { applyCliArgs, missingInput, withCliArgs } from './_cli.ts'

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
  args: withCliArgs({
    app: { type: 'positional', required: true },
    force: { type: 'boolean', description: 'Skip confirmation prompt' },
  }),
  async run({ args }) {
    applyCliArgs(args)
    const { cfg, paths } = await loadAppOrExit(args.app)
    // loadAppOrExit guarantees cfg.apps[args.app] exists.
    const appCfg = cfg.apps[args.app] as NonNullable<(typeof cfg.apps)[string]>

    if (!args.force) {
      if (!canPrompt()) {
        missingInput('missing required confirmation for jib remove', [
          { field: 'force', message: 'rerun with --force or enable interactive prompts' },
        ])
      }
      const ingressSummary =
        appCfg.domains.length > 0 ? ` (${appCfg.domains.map((d) => d.host).join(', ')})` : ''
      const ok = await promptConfirm({
        message: `Remove app "${args.app}"${ingressSummary}?`,
        initialValue: false,
      })
      if (!ok) {
        return { app: args.app, removed: false }
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
        if (isTextOutput()) consola.info('nginx routes released')
      })
    } catch (err) {
      if (isTextOutput()) {
        consola.warn(`nginx release: ${err instanceof Error ? err.message : String(err)}`)
      }
    }

    try {
      const compose = composeFor(cfg, paths, args.app)
      await compose.down(false, { quiet: !isTextOutput() })
      if (isTextOutput()) consola.info('containers stopped')
    } catch (err) {
      if (isTextOutput()) {
        consola.warn(`compose down: ${err instanceof Error ? err.message : String(err)}`)
      }
    }

    try {
      await removeSource(paths, args.app, appCfg.repo)
    } catch (err) {
      if (isTextOutput()) {
        consola.warn(`repo cleanup: ${err instanceof Error ? err.message : String(err)}`)
      }
    }

    const nextApps = { ...cfg.apps }
    delete nextApps[args.app]
    await writeConfig(paths.configFile, { ...cfg, apps: nextApps })
    if (isTextOutput()) consola.success(`removed ${args.app}`)
    return { app: args.app, removed: true }
  },
})
