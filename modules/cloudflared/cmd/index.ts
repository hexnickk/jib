import type { CommandDef } from 'citty'
import { defineCommand } from 'citty'
import setup from './setup.ts'
import status from './status.ts'

const commands: CommandDef[] = [
  defineCommand({
    meta: { name: 'cloudflared', description: 'Manage Cloudflare Tunnel' },
    subCommands: { setup, status },
  }),
]
export default commands
