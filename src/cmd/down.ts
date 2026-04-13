import { cliIsTextOutput } from '@jib/cli'
import { configLoadAppContext } from '@jib/config'
import { deployCreateDeps, deployDownApp } from '@jib/deploy'
import { consola } from 'consola'
import type { CliCommand } from './command.ts'

const cliDownCommand = {
  command: 'down <app>',
  describe: 'Stop containers without removing app from config',
  async run(args) {
    const appName = String(args.app)
    const loaded = await configLoadAppContext(appName)
    if (loaded instanceof Error) return loaded
    const result = await deployDownApp(deployCreateDeps(loaded.cfg, loaded.paths, 'down'), appName)
    if (result) return result
    if (cliIsTextOutput()) consola.success(`stopped ${appName}`)
    return { app: appName, state: 'stopped' as const }
  },
} satisfies CliCommand

export default cliDownCommand
