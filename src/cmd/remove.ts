import { cliCanPrompt, cliCreateMissingInputError } from '@jib/cli'
import { configLoadAppContext } from '@jib/config'
import { tuiPromptConfirmResult } from '@jib/tui'
import { consola } from 'consola'
import type { ArgumentsCamelCase, CommandModule } from 'yargs'
import { removeApp } from '@/flows/remove/index.ts'
import { cmdCreateHandler } from './handler.ts'

const cliRemoveCommand = {
  command: 'remove <app>',
  describe: 'Remove an app completely',
  builder: {
    force: { type: 'boolean', description: 'Skip confirmation prompt' },
  },
  handler: cmdCreateHandler(removeRunCommand),
} satisfies CommandModule<Record<string, unknown>, { app: string; force?: boolean }>

/** Confirms app removal and reports its outcome. */
async function removeRunCommand(args: ArgumentsCamelCase<{ app: string; force?: boolean }>) {
  const appName = String(args.app)
  const loaded = await configLoadAppContext(appName)
  if (loaded instanceof Error) {
    return loaded
  }
  const { cfg, paths } = loaded
  const appCfg = cfg.apps[appName] as NonNullable<(typeof cfg.apps)[string]>

  if (!args.force) {
    if (!cliCanPrompt()) {
      return cliCreateMissingInputError('missing required confirmation for jib remove', [
        { field: 'force', message: 'rerun with --force or enable interactive prompts' },
      ])
    }
    const ingressSummary =
      appCfg.domains.length > 0
        ? ` (${appCfg.domains.map((domain) => domain.host).join(', ')})`
        : ''
    const ok = await tuiPromptConfirmResult({
      message: `Remove app "${appName}"${ingressSummary}?`,
      initialValue: false,
    })
    if (ok instanceof Error) {
      return ok
    }
    if (!ok) {
      return
    }
  }

  const result = await removeApp({ paths, cfg }, appName)
  if (result instanceof Error) {
    return result
  }
  consola.success(`removed ${appName}`)
}

export default cliRemoveCommand
