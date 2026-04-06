import { mkdir, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { loadConfig, writeConfig } from '@jib/config'
import { credsPath, getPaths } from '@jib/core'
import { promptPassword, promptSelect, promptString } from '@jib/tui'
import { type CommandDef, defineCommand } from 'citty'
import { consola } from 'consola'
import { addDomain, removeDomain } from './cli-domain.ts'
import { CloudflareClient } from './client.ts'

/**
 * `jib cloudflare setup|status|add-domain|remove-domain`. Advanced commands
 * for users who want API-managed tunnel routes + DNS. For basic tunnel
 * usage, `jib init` handles token storage and cloudflared install directly.
 */

const setup = defineCommand({
  meta: { name: 'setup', description: 'Configure Cloudflare Tunnel via API (advanced)' },
  args: {
    'api-token': { type: 'string', description: 'Cloudflare API token (skip prompt)' },
    'tunnel-name': { type: 'string', description: 'Tunnel name (default: jib-$HOSTNAME)' },
  },
  async run({ args }) {
    const paths = getPaths()
    const token = args['api-token'] ?? (await promptPassword({ message: 'Cloudflare API token' }))
    const client = new CloudflareClient({ token })

    consola.info('verifying token')
    const { accountId } = await client.verifyToken()
    consola.success(`account ${accountId}`)

    const tunnels = await client.listTunnels(accountId)
    const mode =
      tunnels.length === 0
        ? 'create'
        : await promptSelect<'create' | 'pick'>({
            message: 'Use an existing tunnel or create a new one?',
            options: [
              { value: 'pick', label: 'Pick existing' },
              { value: 'create', label: 'Create new' },
            ],
          })

    let tunnelId: string
    if (mode === 'pick') {
      tunnelId = await promptSelect<string>({
        message: 'Tunnel',
        options: tunnels.map((t) => ({ value: t.id, label: t.name })),
      })
    } else {
      const name = args['tunnel-name'] ?? (await promptString({ message: 'Tunnel name' }))
      const secret = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64')
      const tunnel = await client.createTunnel(accountId, name, secret)
      tunnelId = tunnel.id
      consola.success(`created tunnel ${tunnel.name} (${tunnel.id})`)
    }

    const tokenFile = credsPath(paths, 'cloudflare', 'api-token')
    await mkdir(dirname(tokenFile), { recursive: true, mode: 0o700 })
    await writeFile(tokenFile, token, { mode: 0o600 })

    const cfg = await loadConfig(paths.configFile)
    cfg.tunnel = { provider: 'cloudflare', tunnel_id: tunnelId, account_id: accountId }
    await writeConfig(paths.configFile, cfg)
    consola.success('cloudflare tunnel configured')
  },
})

const status = defineCommand({
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
    meta: { name: 'cloudflare', description: 'Manage Cloudflare Tunnel (advanced)' },
    subCommands: { setup, status, 'add-domain': addDomain, 'remove-domain': removeDomain },
  }),
]
export default commands
