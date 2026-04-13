import { cliIsTextOutput } from '@jib/cli'
import { configLoadAppContext } from '@jib/config'
import { deployCreateDeps, deployRestartApp } from '@jib/deploy'
import { consola } from 'consola'
import type { CliCommand } from './command.ts'

const cliRestartCommand = {
  command: 'restart <app>',
  describe: 'Restart containers without redeploying',
  async run(args) {
    const appName = String(args.app)
    const loaded = await configLoadAppContext(appName)
    if (loaded instanceof Error) return loaded
    const result = await deployRestartApp(
      deployCreateDeps(loaded.cfg, loaded.paths, 'restart'),
      appName,
    )
    if (result) return result
    if (cliIsTextOutput()) consola.success(`restarted ${appName}`)
    return { app: appName, state: 'restarted' as const }
  },
} satisfies CliCommand

export default cliRestartCommand
