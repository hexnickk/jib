import { loadConfig } from '@jib/config'
import { createLogger, getPaths } from '@jib/core'
import { type CommandDef, defineCommand } from 'citty'
import { consola } from 'consola'
import { setup as runSetup } from './setup.ts'

/**
 * `jib cloudflared setup|status`. Token-based tunnel management.
 * `setup` is the canonical interactive flow, also called by `jib init`.
 */

const setupCmd = defineCommand({
  meta: { name: 'setup', description: 'Configure Cloudflare Tunnel token' },
  async run() {
    const paths = getPaths()
    const config = await loadConfig(paths.configFile)
    await runSetup({ config, logger: createLogger('cloudflared'), paths })
  },
})

const statusCmd = defineCommand({
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

const commands: CommandDef[] = [
  defineCommand({
    meta: { name: 'cloudflared', description: 'Manage Cloudflare Tunnel' },
    subCommands: { setup: setupCmd, status: statusCmd },
  }),
]
export default commands
