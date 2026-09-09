import { configLoadAppContext } from '@jib/config'
import { deployCreateDeps, deployRestartApp } from '@jib/deploy'
import { consola } from 'consola'
import type { ArgumentsCamelCase, CommandModule } from 'yargs'
import { cmdCreateHandler } from './handler.ts'

const cliRestartCommand = {
  command: 'restart <app>',
  describe: 'Restart containers without redeploying',
  handler: cmdCreateHandler(restartRunCommand),
} satisfies CommandModule<Record<string, unknown>, { app: string }>

/** Restarts the app containers and reports success. */
async function restartRunCommand(args: ArgumentsCamelCase<{ app: string }>) {
  const appName = String(args.app)
  const loaded = await configLoadAppContext(appName)
  if (loaded instanceof Error) {
    return loaded
  }
  const result = await deployRestartApp(
    deployCreateDeps(loaded.cfg, loaded.paths, 'restart'),
    appName,
  )
  if (result) {
    return result
  }
  consola.success(`restarted ${appName}`)
}

export default cliRestartCommand
