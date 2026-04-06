import { existsSync, readFileSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { extractTunnelToken } from '@jib-module/cloudflared'
import type { Config } from '@jib/config'
import { type ModuleContext, credsPath } from '@jib/core'
import { promptConfirm, promptPassword } from '@jib/tui'
import { $ } from 'bun'
import { consola } from 'consola'

/**
 * Prompt the user for a Cloudflare Tunnel token, store it to disk, and
 * enable the jib-cloudflared systemd unit. Detects an existing token on
 * disk and lets the user keep it.
 */
export async function promptTunnelToken(ctx: ModuleContext<Config>): Promise<void> {
  const tokenPath = credsPath(ctx.paths, 'cloudflare', 'tunnel.env')
  const hasToken = existsSync(tokenPath) && readFileSync(tokenPath, 'utf8').trim().length > 0

  let shouldPrompt = true
  if (hasToken) {
    shouldPrompt = await promptConfirm({
      message: 'Existing tunnel token found. Replace it?',
      initialValue: false,
    })
    if (!shouldPrompt) {
      consola.success('keeping existing tunnel token')
      await $`systemctl enable --now jib-cloudflared`.quiet().nothrow()
    }
  }

  if (shouldPrompt) {
    consola.info('Create a tunnel at dash.cloudflare.com → Zero Trust → Tunnels,')
    consola.info('then paste the install command or just the token.')
    try {
      const raw = await promptPassword({
        message: 'Tunnel token (or full "cloudflared service install <token>" command)',
      })
      const token = extractTunnelToken(raw)
      if (token) {
        await mkdir(dirname(tokenPath), { recursive: true, mode: 0o750 })
        await writeFile(tokenPath, `TUNNEL_TOKEN=${token}\n`, { mode: 0o640 })
        consola.success(`tunnel token saved to ${tokenPath}`)
        await $`systemctl enable --now jib-cloudflared`.quiet().nothrow()
        consola.success('cloudflared started')
      }
    } catch (err) {
      consola.warn(
        `tunnel token setup skipped: ${err instanceof Error ? err.message : String(err)}`,
      )
    }
  }
}
