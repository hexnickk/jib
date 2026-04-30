import { cliIsTextOutput } from '@jib/cli'
import { configLoadAppContext } from '@jib/config'
import { deployCreateDeps, deployUpApp } from '@jib/deploy'
import { consola } from 'consola'
import type { ArgumentsCamelCase, CommandModule } from 'yargs'
import { cmdCreateHandler } from './handler.ts'

const cliUpCommand = {
  command: 'up <app>',
  describe: 'Start existing containers without rebuilding',
  handler: cmdCreateHandler(upRunCommand),
} satisfies CommandModule<Record<string, unknown>, { app: string }>

/** Runs the up command and returns a start payload or typed error. */
async function upRunCommand(args: ArgumentsCamelCase<{ app: string }>) {
  const appName = String(args.app)
  const loaded = await configLoadAppContext(appName)
  if (loaded instanceof Error) return loaded
  const result = await deployUpApp(deployCreateDeps(loaded.cfg, loaded.paths, 'up'), appName)
  if (result) return result
  if (cliIsTextOutput()) consola.success(`started ${appName}`)
  return { app: appName, state: 'started' as const }
}

export default cliUpCommand
