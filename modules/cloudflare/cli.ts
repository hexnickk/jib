import { loadConfig } from '@jib/config'
import { credsPath, getPaths } from '@jib/core'
import { type CommandDef, defineCommand } from 'citty'
import { consola } from 'consola'
import { addDomain, removeDomain } from './cli-domain.ts'
import { CloudflareClient } from './client.ts'
import { runCloudflareSetup } from './setup-flow.ts'

/**
 * `jib cloudflare setup|status|add-domain|remove-domain`. Mounted under the
 * root CLI via `src/module-cli.ts` discovery. `setup` calls the shared
 * `runCloudflareSetup` flow (also used by `jib init`); `add-domain` /
 * `remove-domain` go through the NATS operator.
 */

const setup = defineCommand({
  meta: { name: 'setup', description: 'Configure Cloudflare Tunnel (interactive)' },
  async run() {
    await runCloudflareSetup(getPaths())
  },
})

const status = defineCommand({
  meta: { name: 'status', description: 'Show Cloudflare Tunnel status' },
  async run() {
    const paths = getPaths()
    const cfg = await loadConfig(paths.configFile)
    if (!cfg.tunnel || cfg.tunnel.provider !== 'cloudflare') {
      consola.info('cloudflare tunnel: not configured — run `jib cloudflare setup`')
      return
    }
    consola.info('cloudflare tunnel: configured')
    if (cfg.tunnel.tunnel_id) {
      consola.log(`  tunnel id:  ${cfg.tunnel.tunnel_id}`)
      consola.log(`  account id: ${cfg.tunnel.account_id ?? '(unknown)'}`)
      const token = await Bun.file(credsPath(paths, 'cloudflare', 'api-token'))
        .text()
        .catch(() => '')
      if (token.trim().length === 0) {
        consola.warn('  API token missing — route updates will fail')
        return
      }
      const client = new CloudflareClient({ token: token.trim() })
      const rules = await client.getTunnelIngress(cfg.tunnel.account_id ?? '', cfg.tunnel.tunnel_id)
      consola.log(`  ingress rules: ${rules.length}`)
    }
  },
})

const commands: CommandDef[] = [
  defineCommand({
    meta: { name: 'cloudflare', description: 'Manage Cloudflare Tunnel integration' },
    subCommands: { setup, status, 'add-domain': addDomain, 'remove-domain': removeDomain },
  }),
]
export default commands
