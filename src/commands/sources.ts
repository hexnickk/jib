import { loadConfig } from '@jib/config'
import { getPaths } from '@jib/core'
import { defineCommand } from 'citty'
import { setupSourceRef } from './sources-flow.ts'

const setupCmd = defineCommand({
  meta: { name: 'setup', description: 'Set up a git source ref' },
  async run() {
    const paths = getPaths()
    const config = await loadConfig(paths.configFile)
    const source = await setupSourceRef(config, paths)
    return { ok: source !== null, ...(source ? { source } : {}) }
  },
})

export default defineCommand({
  meta: { name: 'sources', description: 'Manage git source refs' },
  subCommands: { setup: setupCmd },
})
