import { mkdir, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { loadConfig, writeConfig } from '@jib/config'
import { credsPath, getPaths } from '@jib/core'
import { promptPassword, promptSelect, promptString } from '@jib/tui'
import { type CommandDef, defineCommand } from 'citty'
import { consola } from 'consola'
import { CloudflareClient } from './client.ts'

/**
 * `jib cloudflare setup|status`. Advanced commands for API-managed tunnel
 * configuration. For basic tunnel usage, `jib init` handles token storage
 * and cloudflared install directly — no API calls needed.
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

const setToken = defineCommand({
  meta: {
    name: 'set-token',
    description: 'Store a Cloudflare Tunnel token and start cloudflared',
  },
  args: {
    token: {
      type: 'positional',
      description: 'Tunnel token from the CF dashboard install command',
    },
  },
  async run({ args }) {
    const { extractTunnelToken } = await import('@jib-module/cloudflared')
    const paths = getPaths()
    const raw =
      args.token ??
      (await promptPassword({
        message: 'Paste the tunnel token or the full install/run command from CF dashboard',
      }))
    const token = extractTunnelToken(raw)
    if (!token) {
      consola.error('empty token')
      process.exit(1)
    }
    const tokenPath = credsPath(paths, 'cloudflare', 'tunnel.env')
    await mkdir(dirname(tokenPath), { recursive: true, mode: 0o700 })
    await writeFile(tokenPath, `TUNNEL_TOKEN=${token}\n`, { mode: 0o600 })
    consola.success('tunnel token stored')
    const { $ } = await import('bun')
    await $`systemctl enable --now jib-cloudflared`.quiet().nothrow()
    consola.success('cloudflared started')
  },
})

const commands: CommandDef[] = [
  defineCommand({
    meta: { name: 'cloudflare', description: 'Manage Cloudflare Tunnel' },
    subCommands: { setup, status, 'set-token': setToken },
  }),
]
export default commands
