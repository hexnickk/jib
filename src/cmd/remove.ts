import { applyCliArgs, canPrompt, isTextOutput, missingInput, withCliArgs } from '@jib/cli'
import { loadAppOrExit } from '@jib/config'
import { createIngressOperator, releaseIngress } from '@jib/ingress'
import type { Paths } from '@jib/paths'
import { promptConfirm, spinner } from '@jib/tui'
import { defineCommand } from 'citty'
import { consola } from 'consola'
import { DefaultRemoveSupport, RemoveMissingAppError, runRemove } from '../modules/remove/index.ts'

/** `jib remove <app>` — prompt in the CLI, then delegate teardown to the remove module. */

export default defineCommand({
  meta: { name: 'remove', description: 'Remove an app completely' },
  args: withCliArgs({
    app: { type: 'positional', required: true },
    force: { type: 'boolean', description: 'Skip confirmation prompt' },
  }),
  async run({ args }) {
    applyCliArgs(args)
    const { cfg, paths } = await loadAppOrExit(args.app)
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

    const result = await runRemove(
      {
        support: new DefaultRemoveSupport({
          paths,
          releaseIngress: (appName) => releaseIngressForRemove(paths, appName),
        }),
        observer: {
          warn: (message) => {
            if (isTextOutput()) consola.warn(message)
          },
        },
      },
      {
        appName: args.app,
        cfg,
        configFile: paths.configFile,
        quiet: !isTextOutput(),
      },
    )
    if (result instanceof RemoveMissingAppError) throw result
    if (isTextOutput()) consola.success(`removed ${args.app}`)
    return { app: args.app, removed: true }
  },
})

async function releaseIngressForRemove(paths: Paths, app: string): Promise<void> {
  const s = isTextOutput() ? spinner() : null
  s?.start(`releasing ingress for ${app}`)
  try {
    await releaseIngress(createIngressOperator(paths), app, (progress) =>
      s?.message(progress.message),
    )
    s?.stop('ingress released')
  } catch (error) {
    s?.stop('ingress release failed')
    throw error
  }
}
