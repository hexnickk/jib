import { defineCommand } from 'citty'
import { listServicesCmd, startServiceCmd } from '../service-runtime.ts'

export default defineCommand({
  meta: {
    name: 'service',
    description: 'Inspect long-running jib operators and mirror jib-daemon controls',
  },
  subCommands: { start: startServiceCmd, list: listServicesCmd },
})
