import { withBus } from '@jib/bus'
import { loadAppOrExit } from '@jib/config'
import { canPrompt, isTextOutput } from '@jib/core'
import { DefaultRemoveSupport, RemoveService } from '@jib/flows'
import { createBusIngressOperator, releaseIngress } from '@jib/ingress'
import { promptConfirm, spinner } from '@jib/tui'
import { defineCommand } from 'citty'
import { consola } from 'consola'
import { applyCliArgs, missingInput, withCliArgs } from './_cli.ts'

/** `jib remove <app>` — prompt in the CLI, then delegate teardown to flows. */

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

    const service = new RemoveService(
      new DefaultRemoveSupport({
        paths,
        releaseIngress: (appName) => releaseIngressForRemove(appName),
      }),
      {
        warn: (message) => {
          if (isTextOutput()) consola.warn(message)
        },
      },
    )
    await service.run({
      appName: args.app,
      cfg,
      configFile: paths.configFile,
      quiet: !isTextOutput(),
    })
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
