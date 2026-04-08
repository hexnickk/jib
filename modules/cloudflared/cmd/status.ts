import { loadConfig } from '@jib/config'
import { getPaths } from '@jib/core'
import { defineCommand } from 'citty'
import { consola } from 'consola'

export default defineCommand({
  meta: { name: 'status', description: 'Show Cloudflare Tunnel status' },
  async run() {
    const paths = getPaths()
    const cfg = await loadConfig(paths.configFile)
    if (!cfg.tunnel || cfg.tunnel.provider !== 'cloudflare') {
      consola.info('cloudflare tunnel: not configured')
      return
    }
    consola.info('cloudflare tunnel: configured')
    if (cfg.tunnel.tunnel_id) {
      consola.log(`  tunnel id:  ${cfg.tunnel.tunnel_id}`)
      consola.log(`  account id: ${cfg.tunnel.account_id ?? '(unknown)'}`)
    }
  },
})
