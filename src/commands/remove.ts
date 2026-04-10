import { withBus } from '@jib/bus'
import { loadAppOrExit, writeConfig } from '@jib/config'
import { canPrompt, isTextOutput } from '@jib/core'
import { composeFor } from '@jib/docker'
import { createBusIngressOperator, releaseIngress } from '@jib/ingress'
import { removeSource } from '@jib/sources'
import { promptConfirm, spinner } from '@jib/tui'
import { defineCommand } from 'citty'
import { consola } from 'consola'
import { applyCliArgs, missingInput, withCliArgs } from './_cli.ts'

/**
 * `jib remove <app>` — reverse of add. Order matters:
 *   1. ingress release — stop accepting traffic first
 *   2. `docker compose down` — stop the app itself
 *   3. repo cleanup — remove the cached checkout
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

    if (appCfg.domains.length > 0) {
      try {
        await releaseIngressForRemove(args.app)
        if (isTextOutput()) consola.info('ingress released')
      } catch (err) {
        if (isTextOutput()) {
          consola.warn(`ingress release: ${err instanceof Error ? err.message : String(err)}`)
        }
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

async function releaseIngressForRemove(app: string): Promise<void> {
  await withBus(async (bus) => {
    const s = isTextOutput() ? spinner() : null
    s?.start(`releasing ingress for ${app}`)
    try {
      await releaseIngress(createBusIngressOperator(bus, DEFAULT_TIMEOUT_MS), app, (progress) =>
        s?.message(progress.message),
      )
      s?.stop('ingress released')
    } catch (error) {
      s?.stop('ingress release failed')
      throw error
    }
  })
}
