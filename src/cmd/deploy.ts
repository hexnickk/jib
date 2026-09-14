import { configLoadAppContext } from '@jib/config'
import { consola } from 'consola'
import type { ArgumentsCamelCase, CommandModule } from 'yargs'
import { runDeploy } from '@/flows/deploy/run.ts'
import { cmdCreateHandler } from './handler.ts'

const cliDeployCommand = {
  command: 'deploy <app>',
  describe: 'Sync source, build and deploy an app',
  builder: {
    ref: { type: 'string', description: 'Git ref (SHA, branch, tag)' },
  },
  handler: cmdCreateHandler(deployRunCommand),
} satisfies CommandModule<Record<string, unknown>, { app: string; ref?: string }>

/** Deploys an app and displays its deployed revision. */
async function deployRunCommand(args: ArgumentsCamelCase<{ app: string; ref?: string }>) {
  const appName = String(args.app)
  const loaded = await configLoadAppContext(appName)
  if (loaded instanceof Error) {
    return loaded
  }
  const { cfg, paths } = loaded
  const result = await runDeploy(
    { cfg, paths },
    appName,
    typeof args.ref === 'string' ? args.ref : undefined,
  )
  if (result instanceof Error) {
    return result
  }
  consola.success(`${appName} deployed @ ${result.sha.slice(0, 8)} (${result.durationMs}ms)`)
}

export default cliDeployCommand
