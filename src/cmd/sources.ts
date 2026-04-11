import { loadConfig } from '@jib/config'
import { getPaths } from '@jib/paths'
import { setupSourceRef } from '@jib/sources'
import { promptSelect } from '@jib/tui'
import { defineCommand } from 'citty'

const setupCmd = defineCommand({
  meta: { name: 'setup', description: 'Set up a git source ref' },
  async run() {
    const paths = getPaths()
    const config = await loadConfig(paths.configFile)
    const source = await setupSourceRef(config, paths, { promptSelect })
    return { ok: source !== null, ...(source ? { source } : {}) }
  },
})

export default defineCommand({
  meta: { name: 'sources', description: 'Manage git source refs' },
  subCommands: { setup: setupCmd },
})
