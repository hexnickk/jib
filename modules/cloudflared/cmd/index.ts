import type { CommandDef } from 'citty'
import { defineCommand } from 'citty'
import setup from './setup.ts'
import status from './status.ts'

export const cloudflaredCmd = defineCommand({
  meta: { name: 'cloudflared', description: 'Manage Cloudflare Tunnel' },
  subCommands: { setup, status },
})

const commands: CommandDef[] = [cloudflaredCmd]
export default commands
