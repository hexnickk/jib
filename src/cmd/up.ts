import { cliIsTextOutput } from '@jib/cli'
import { configLoadAppContext } from '@jib/config'
import { deployCreateDeps, deployUpApp } from '@jib/deploy'
import { consola } from 'consola'
import type { CliCommand } from './command.ts'

const cliUpCommand = {
  command: 'up <app>',
  describe: 'Start existing containers without rebuilding',
  async run(args) {
    const appName = String(args.app)
    const loaded = await configLoadAppContext(appName)
    if (loaded instanceof Error) return loaded
    const result = await deployUpApp(deployCreateDeps(loaded.cfg, loaded.paths, 'up'), appName)
    if (result) return result
    if (cliIsTextOutput()) consola.success(`started ${appName}`)
    return { app: appName, state: 'started' as const }
  },
} satisfies CliCommand

export default cliUpCommand
