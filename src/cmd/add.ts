import type { CommandModule } from 'yargs'
import { type AddCommandArgs, addRunCommand } from '@/flows/add/command.ts'
import { addCommandOptions } from './add-args.ts'
import { cmdCreateHandler } from './handler.ts'

const cliAddCommand = {
  command: 'add [app]',
  describe: 'Register and deploy a new app',
  builder: addCommandOptions,
  handler: cmdCreateHandler(addRunCommand),
} satisfies CommandModule<Record<string, unknown>, AddCommandArgs>

export default cliAddCommand
