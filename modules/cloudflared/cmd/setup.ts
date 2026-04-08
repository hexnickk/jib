import { loadConfig } from '@jib/config'
import { createLogger, getPaths } from '@jib/core'
import { defineCommand } from 'citty'
import { setup as runSetup } from '../setup.ts'

export default defineCommand({
  meta: { name: 'setup', description: 'Configure Cloudflare Tunnel token' },
  async run() {
    const paths = getPaths()
    const config = await loadConfig(paths.configFile)
    await runSetup({ config, logger: createLogger('cloudflared'), paths })
  },
})
