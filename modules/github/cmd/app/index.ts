import { defineCommand } from 'citty'
import remove from './remove.ts'
import setup from './setup.ts'
import status from './status.ts'

export default defineCommand({
  meta: { name: 'app', description: 'Manage GitHub App providers' },
  subCommands: { setup, status, remove },
})
