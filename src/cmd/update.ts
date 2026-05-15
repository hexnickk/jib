import { updateRunResult } from '@jib/update'
import type { CommandModule } from 'yargs'
import { cmdCreateHandler } from './handler.ts'

const updateCommand = {
  command: 'update',
  describe: 'Update jib from the latest GitHub release',
  handler: cmdCreateHandler(() => updateRunResult()),
} satisfies CommandModule

export default updateCommand
