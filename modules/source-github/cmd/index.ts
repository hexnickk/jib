import type { CommandDef } from 'citty'
import { defineCommand } from 'citty'
import app from './app/index.ts'
import key from './key/index.ts'

export const githubCmd = defineCommand({
  meta: { name: 'github', description: 'Manage GitHub source refs' },
  subCommands: { key, app },
})

const commands: CommandDef[] = [githubCmd]
export default commands
