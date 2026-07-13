import { runDeploy } from '@/flows/deploy/run.ts'
import { cliIsTextOutput } from '@jib/cli'
import { configLoadAppContext } from '@jib/config'
import { consola } from 'consola'
import type { ArgumentsCamelCase, CommandModule } from 'yargs'
import { cmdCreateHandler } from './handler.ts'

const cliDeployCommand = {
  command: 'deploy <app>',
  describe: 'Build and deploy an app',
  builder: {
    ref: { type: 'string', description: 'Git ref (SHA, branch, tag)' },
  },
  handler: cmdCreateHandler(deployRunCommand),
} satisfies CommandModule<Record<string, unknown>, { app: string; ref?: string }>

/** Runs the deploy command and returns its deployment payload or typed error. */
async function deployRunCommand(args: ArgumentsCamelCase<{ app: string; ref?: string }>) {
  const appName = String(args.app)
  const loaded = await configLoadAppContext(appName)
  if (loaded instanceof Error) return loaded
  const { cfg, paths } = loaded
  const result = await runDeploy(
    cfg,
    paths,
    appName,
    typeof args.ref === 'string' ? args.ref : undefined,
  )
  if (cliIsTextOutput()) {
    consola.success(`${appName} deployed @ ${result.sha.slice(0, 8)} (${result.durationMs}ms)`)
  }
  return result
}

export default cliDeployCommand
