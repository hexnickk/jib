import { mkdir, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { loadConfig, writeConfig } from '@jib/config'
import { type Paths, credsPath } from '@jib/core'
import { promptPassword, promptSelect, promptString } from '@jib/tui'
import { consola } from 'consola'
import { CloudflareClient } from './client.ts'

/**
 * Core Cloudflare setup flow: verify API token, create/pick a tunnel, store
 * credentials, update config. Shared by `jib cloudflare setup` (CLI) and
 * `jib init` (inline post-install). Extracted so neither caller duplicates
 * the 60-line interactive prompt chain.
 *
 * Does NOT add a root domain via the NATS operator — the operator may not
 * be ready yet during `jib init`. Instead, prompts for a domain and adds
 * ingress routes + DNS records directly via the CloudflareClient API.
 */
export async function runCloudflareSetup(paths: Paths): Promise<void> {
  const token = await promptPassword({ message: 'Cloudflare API token' })
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
    const name = await promptString({
      message: 'Tunnel name',
      initialValue: `jib-${process.env.HOSTNAME ?? 'server'}`,
    })
    const secret = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64')
    const tunnel = await client.createTunnel(accountId, name, secret)
    tunnelId = tunnel.id
    consola.success(`created tunnel ${tunnel.name} (${tunnel.id})`)
  }

  // Store API token
  const tokenFile = credsPath(paths, 'cloudflare', 'api-token')
  await mkdir(dirname(tokenFile), { recursive: true, mode: 0o700 })
  await writeFile(tokenFile, token, { mode: 0o600 })

  // Write tunnel config
  const cfg = await loadConfig(paths.configFile)
  cfg.tunnel = { provider: 'cloudflare', tunnel_id: tunnelId, account_id: accountId }
  await writeConfig(paths.configFile, cfg)
  consola.success('cloudflare tunnel configured')

  // Prompt for a root domain and add routes + DNS directly (no NATS operator
  // needed — during init the operator may not be ready yet).
  const rootDomain = await promptString({
    message: 'Root domain to tunnel (e.g. example.com, leave blank to skip)',
  }).catch(() => '')
  if (rootDomain.trim().length > 0) {
    try {
      consola.info(`adding tunnel routes for ${rootDomain.trim()}`)
      const rules = await client.getTunnelIngress(accountId, tunnelId)
      const apex = rootDomain.trim()
      const wildcard = `*.${apex}`
      const existing = new Set(rules.map((r) => r.hostname).filter(Boolean))
      const toAdd = [apex, wildcard].filter((h) => !existing.has(h))
      if (toAdd.length > 0) {
        const newRules = [
          ...rules.filter((r) => r.service !== 'http_status:404'),
          ...toAdd.map((hostname) => ({ hostname, service: 'http://localhost:80' })),
          { service: 'http_status:404' },
        ]
        await client.putTunnelIngress(accountId, tunnelId, newRules)
        consola.success(`tunnel routes added for ${apex} + ${wildcard}`)
      } else {
        consola.info('tunnel routes already exist')
      }
    } catch (err) {
      consola.warn(
        `could not add tunnel routes: ${err instanceof Error ? err.message : String(err)}`,
      )
      consola.warn(`run \`jib cloudflare add-domain ${rootDomain.trim()}\` later to retry`)
    }
  }
}
