import { existsSync, readFileSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import type { Config } from '@jib/config'
import { type ModuleContext, credsPath } from '@jib/core'
import { log, promptConfirm, promptPassword } from '@jib/tui'
import { $ } from 'bun'
import { extractTunnelToken } from './token.ts'

/**
 * Interactive tunnel token setup, shared between `jib init` (first-run
 * wizard) and `jib cloudflared setup` (standalone CLI). Detects an
 * existing token on disk and lets the user keep it.
 */
export async function setup(ctx: ModuleContext<Config>): Promise<void> {
  const tokenPath = credsPath(ctx.paths, 'cloudflare', 'tunnel.env')
  const hasToken = existsSync(tokenPath) && readFileSync(tokenPath, 'utf8').trim().length > 0

  let shouldPrompt = true
  if (hasToken) {
    shouldPrompt = await promptConfirm({
      message: 'Existing tunnel token found. Replace it?',
      initialValue: false,
    })
    if (!shouldPrompt) {
      log.success('keeping existing tunnel token')
      await $`sudo systemctl enable --now jib-cloudflared`.quiet().nothrow()
      return
    }
  }

  log.info('Create a tunnel at dash.cloudflare.com → Zero Trust → Tunnels,')
  log.info('then paste the install command or just the token.')
  try {
    const raw = await promptPassword({
      message: 'Tunnel token (or full "cloudflared service install <token>" command)',
    })
    const token = extractTunnelToken(raw)
    if (token) {
      await mkdir(dirname(tokenPath), { recursive: true, mode: 0o750 })
      await writeFile(tokenPath, `TUNNEL_TOKEN=${token}\n`, { mode: 0o640 })
      log.success('tunnel token saved')
      await $`sudo systemctl enable --now jib-cloudflared`.quiet().nothrow()
      log.success('cloudflared started')
    }
  } catch (err) {
    log.warning(`tunnel token setup skipped: ${err instanceof Error ? err.message : String(err)}`)
  }
}
