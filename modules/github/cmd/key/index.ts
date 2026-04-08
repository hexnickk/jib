import { defineCommand } from 'citty'
import remove from './remove.ts'
import setup from './setup.ts'
import status from './status.ts'

export default defineCommand({
  meta: { name: 'key', description: 'Manage SSH deploy key providers' },
  subCommands: { setup, status, remove },
})
