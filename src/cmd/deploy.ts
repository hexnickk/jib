import { DEFAULT_TIMEOUT_MS, runDeploy } from '@/flows/deploy/run.ts'
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
    timeout: {
      type: 'string',
      description: 'Timeout in milliseconds',
      default: String(DEFAULT_TIMEOUT_MS),
    },
  },
  handler: cmdCreateHandler(deployRunCommand),
} satisfies CommandModule<Record<string, unknown>, { app: string; ref?: string; timeout?: string }>

/** Runs the deploy command and returns its deployment payload or typed error. */
async function deployRunCommand(
  args: ArgumentsCamelCase<{ app: string; ref?: string; timeout?: string }>,
) {
  const appName = String(args.app)
  const loaded = await configLoadAppContext(appName)
  if (loaded instanceof Error) return loaded
  const { cfg, paths } = loaded
  const timeoutMs = Number(args.timeout) || DEFAULT_TIMEOUT_MS
  const result = await runDeploy(
    cfg,
    paths,
    appName,
    typeof args.ref === 'string' ? args.ref : undefined,
    timeoutMs,
  )
  if (cliIsTextOutput()) {
    consola.success(`${appName} deployed @ ${result.sha.slice(0, 8)} (${result.durationMs}ms)`)
  }
  return result
}

export default cliDeployCommand
