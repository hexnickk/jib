import {
  RemoveMissingAppError,
  RemoveWriteConfigError,
  removeApp,
  removeCreateSupport,
} from '@/flows/remove/index.ts'
import { cliCanPrompt, cliCreateMissingInputError, cliIsTextOutput } from '@jib/cli'
import { configLoadAppContext } from '@jib/config'
import { ingressCreateOperator, ingressRelease } from '@jib/ingress'
import type { Paths } from '@jib/paths'
import { tuiPromptConfirmResult, tuiSpinner } from '@jib/tui'
import { consola } from 'consola'
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
      const ok = await tuiPromptConfirmResult({
        message: `Remove app "${appName}"${ingressSummary}?`,
        initialValue: false,
      })
      if (ok instanceof Error) return ok
      if (!ok) return { app: appName, removed: false }
    }

    const result = await removeApp(
      {
        support: removeCreateSupport({
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
    if (result instanceof RemoveWriteConfigError) return result
    if (cliIsTextOutput()) consola.success(`removed ${appName}`)
    return { app: appName, removed: true }
  },
} satisfies CliCommand

/** Releases managed ingress while mirroring progress through the CLI spinner. */
async function removeReleaseIngress(paths: Paths, app: string): Promise<undefined | Error> {
  const progress = cliIsTextOutput() ? tuiSpinner() : null
  progress?.start(`releasing ingress for ${app}`)
  const error = await ingressRelease(ingressCreateOperator(paths), app, (update) =>
    progress?.message(update.message),
  )
  if (error instanceof Error) {
    progress?.stop('ingress release failed')
    return error
  }
  progress?.stop('ingress released')
  return undefined
}

export default cliRemoveCommand
