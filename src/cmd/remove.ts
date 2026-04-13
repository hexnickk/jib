import { cliCanPrompt, cliCreateMissingInputError, cliIsTextOutput } from '@jib/cli'
import { configLoadAppContext } from '@jib/config'
import { ingressCreateOperator, ingressRelease } from '@jib/ingress'
import type { Paths } from '@jib/paths'
import { promptConfirm, spinner } from '@jib/tui'
import { consola } from 'consola'
import { DefaultRemoveSupport, RemoveMissingAppError, runRemove } from '../modules/remove/index.ts'
import type { CliCommand } from './command.ts'

const cliRemoveCommand = {
  command: 'remove <app>',
  describe: 'Remove an app completely',
  builder: {
    force: { type: 'boolean', description: 'Skip confirmation prompt' },
  },
  async run(args) {
    const appName = String(args.app)
    const loaded = await configLoadAppContext(appName)
    if (loaded instanceof Error) return loaded
    const { cfg, paths } = loaded
    const appCfg = cfg.apps[appName] as NonNullable<(typeof cfg.apps)[string]>

    if (!args.force) {
      if (!cliCanPrompt()) {
        return cliCreateMissingInputError('missing required confirmation for jib remove', [
          { field: 'force', message: 'rerun with --force or enable interactive prompts' },
        ])
      }
      const ingressSummary =
        appCfg.domains.length > 0 ? ` (${appCfg.domains.map((d) => d.host).join(', ')})` : ''
      const ok = await promptConfirm({
        message: `Remove app "${appName}"${ingressSummary}?`,
        initialValue: false,
      })
      if (!ok) return { app: appName, removed: false }
    }

    const result = await runRemove(
      {
        support: new DefaultRemoveSupport({
          paths,
          releaseIngress: (nextAppName) => removeReleaseIngress(paths, nextAppName),
        }),
        observer: {
          warn: (message) => {
            if (cliIsTextOutput()) consola.warn(message)
          },
        },
      },
      { appName, cfg, configFile: paths.configFile, quiet: !cliIsTextOutput() },
    )
    if (result instanceof RemoveMissingAppError) return result
    if (cliIsTextOutput()) consola.success(`removed ${appName}`)
    return { app: appName, removed: true }
  },
} satisfies CliCommand

/** Releases managed ingress while mirroring progress through the CLI spinner. */
async function removeReleaseIngress(paths: Paths, app: string): Promise<void> {
  const progress = cliIsTextOutput() ? spinner() : null
  progress?.start(`releasing ingress for ${app}`)
  try {
    await ingressRelease(ingressCreateOperator(paths), app, (update) =>
      progress?.message(update.message),
    )
    progress?.stop('ingress released')
  } catch (error) {
    progress?.stop('ingress release failed')
    throw error
  }
}

export default cliRemoveCommand
