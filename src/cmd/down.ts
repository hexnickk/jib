import { cliIsTextOutput } from '@jib/cli'
import { configLoadAppContext } from '@jib/config'
import { deployCreateDeps, deployDownApp } from '@jib/deploy'
import { consola } from 'consola'
import type { ArgumentsCamelCase, CommandModule } from 'yargs'
import { cmdCreateHandler } from './handler.ts'

const cliDownCommand = {
  command: 'down <app>',
  describe: 'Stop containers without removing app from config',
  handler: cmdCreateHandler(downRunCommand),
} satisfies CommandModule<Record<string, unknown>, { app: string }>

/** Runs the down command and returns a stop payload or typed error. */
async function downRunCommand(args: ArgumentsCamelCase<{ app: string }>) {
  const appName = String(args.app)
  const loaded = await configLoadAppContext(appName)
  if (loaded instanceof Error) return loaded
  const result = await deployDownApp(deployCreateDeps(loaded.cfg, loaded.paths, 'down'), appName)
  if (result) return result
  if (cliIsTextOutput()) consola.success(`stopped ${appName}`)
  return { app: appName, state: 'stopped' as const }
}

export default cliDownCommand
